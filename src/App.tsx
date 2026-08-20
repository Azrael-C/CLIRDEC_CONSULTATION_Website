import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { supabase, configured } from "./supabase";
import {
  adminSetRole,
  adminSetAccountStatus,
  approveFaqEntry,
  archiveFaqEntry,
  bookAppointment,
  cancelAppointment,
  completeFacultyRequest,
  createFacultyAvailability,
  createFaqEntry,
  decideFacultyRequest,
  loadAdminPortal,
  loadFacultyProfile,
  loadFacultyPortal,
  loadStudentPortal,
  removeFacultyAvailability,
  recordUserPresence,
  resolveChatbotGap,
  rescheduleAppointment,
  submitConsultationReview,
  updateFaqEntry,
  updateFacultyProfile,
  recordClientError,
  type AdminPortal,
  type AppointmentStatus,
  type ConsultationReview,
  type FaqEntry,
  type FaqStatus,
  type FacultyAvailability,
  type FacultyProfile,
  type FacultyRequest,
  type ChatbotGap,
} from "./backend";
import { PrivilegedMfaGate } from "./MfaGate";
import { AdminOperations } from "./AdminOperations";
import {
  appointmentCalendarDetails,
  downloadCalendarFile,
  googleCalendarUrl,
} from "./calendar";
import {
  addCalendarDays,
  availabilityValidationMessage,
  calendarTimes,
  formatCalendarDay,
  formatManilaDateTime,
  formatTime,
  firstBookableStart,
  initialCalendarWeek,
  isUpcomingSlot,
  manilaDateKey,
  manilaInstant,
  weekDays,
} from "./scheduling";
import {
  NotificationCenter,
  type NotificationAppointment,
} from "./Notifications";

type Role = "student" | "faculty" | "admin";
type View = "home" | "find" | "schedule" | "assistant" | "profile";
type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  department?: string;
  student_number?: string;
  college?: string;
  program?: string;
  year_level?: string;
  email_notifications: boolean;
  account_status: "active" | "suspended" | "deactivated";
};
type Slot = {
  id: string;
  faculty_name: string;
  initials: string;
  expertise: string;
  subjects: string[];
  consultationTopics: string[];
  starts_at: string;
  ends_at: string;
  location: string;
  color: string;
  appointment_id?: string;
  status?: AppointmentStatus;
  topic?: string;
  notes?: string;
  updated_at?: string;
  review?: ConsultationReview;
  booking_open?: boolean;
};
type ChatMessage = {
  who: "you" | "bot";
  text: string;
  source?: string;
  escalation?: boolean;
  suggestions?: string[];
};

type ChatbotReply = {
  answer: string;
  intent: string;
  confidence: number;
  escalation: boolean;
  source?: string;
  suggestions?: string[];
};

type ChatAskResult = "ok" | "challenge" | "error";

type AuthAction = "login" | "signup" | "reset";

const STUDENT_EMAIL_DOMAINS = ["gmail.com", "clsu2.edu.ph"] as const;
const TURNSTILE_SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "");
const PRODUCTION_SECURITY_READY = !import.meta.env.PROD || Boolean(TURNSTILE_SITE_KEY);

function chatbotBaseUrl() {
  const configuredBase = String(import.meta.env.VITE_CHATBOT_URL || "").replace(
    /\/$/,
    "",
  );
  return configuredBase || (import.meta.env.PROD ? "/api" : "http://localhost:8000");
}

class ChatbotRequestError extends Error {
  status: number;

  constructor(status: number) {
    super(`Assistant returned ${status}`);
    this.name = "ChatbotRequestError";
    this.status = status;
  }
}

type ChatTrustState = { trusted: boolean; expiresInSeconds: number };

async function getChatTrustStatus(): Promise<ChatTrustState> {
  try {
    const response = await fetch(`${chatbotBaseUrl()}/chat/session`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return { trusted: false, expiresInSeconds: 0 };
    const payload = (await response.json()) as {
      trusted?: boolean;
      expires_in_seconds?: number;
    };
    return {
      trusted: Boolean(payload.trusted),
      expiresInSeconds: Math.max(0, Number(payload.expires_in_seconds) || 0),
    };
  } catch {
    return { trusted: false, expiresInSeconds: 0 };
  }
}

async function clearChatTrustSession() {
  try {
    await fetch(`${chatbotBaseUrl()}/chat/session`, {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    // Supabase sign-out must still complete if the chatbot API is unavailable.
  }
}

async function requestChatbotReply(message: string, captchaToken?: string): Promise<ChatbotReply> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (data.session?.access_token)
    headers.Authorization = `Bearer ${data.session.access_token}`;
  if (captchaToken) headers["X-Turnstile-Token"] = captchaToken;
  const response = await fetch(`${chatbotBaseUrl()}/chat`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new ChatbotRequestError(response.status);
  return response.json() as Promise<ChatbotReply>;
}

function isAllowedStudentEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@").at(-1);
  return STUDENT_EMAIL_DOMAINS.some((allowed) => domain === allowed);
}

function friendlyAuthError(message: string, action: AuthAction) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "The email address or password is incorrect. Check your details and try again.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Confirm your email address using the link we sent before signing in.";
  }
  if (
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("user already exists")
  ) {
    return "An account already exists for this email address. Sign in or reset your password instead.";
  }
  if (normalized.includes("rate limit")) {
    return "Too many attempts were made. Wait a few minutes, then try again.";
  }
  if (normalized.includes("invalid email")) {
    return "Enter a valid email address.";
  }
  if (
    action === "signup" &&
    (normalized.includes("database error") ||
      normalized.includes("student registration requires") ||
      normalized.includes("saving new user"))
  ) {
    return "We couldn't create this account. Use a Gmail or CLSU student email address and confirm that the student number is not already registered.";
  }
  if (action === "reset") {
    return "We couldn't send the reset link right now. Check the email address and try again shortly.";
  }
  return action === "signup"
    ? "We couldn't create the account right now. Review the information and try again."
    : "We couldn't sign you in right now. Please try again.";
}

function usePageMetadata(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [title, description]);
}

function SkipLink() {
  return (
    <a className="skip-link" href="#main-content">
      Skip to main content
    </a>
  );
}

function PortalLoader({
  label,
  detail = "Please keep this page open while we prepare your workspace.",
  compact = false,
}: {
  label: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "portal-loader compact" : "portal-loader"}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="portal-loader-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="portal-loader-copy">
        <b>{label}</b>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function ButtonLoading({ label }: { label: string }) {
  return (
    <span className="button-loading">
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(configured);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [view, setView] = useState<View>("home");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [booked, setBooked] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [bookingTopic, setBookingTopic] = useState("");
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      who: "bot",
      text: "Hi! I use approved CLIRDEC information. Ask about services, office hours, consultation procedures, faculty availability, or official contacts.",
    },
  ]);
  const [question, setQuestion] = useState("");
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const forgotPasswordPath = pathname === "/forgot-password";
  const studentMetadata: Record<View, [string, string]> = {
    home: [
      "Student overview | CLSU FacultyConnect",
      "Access approved consultation guidance, requests, and faculty availability.",
    ],
    find: [
      "Faculty availability | CLSU FacultyConnect",
      "Browse faculty-published consultation schedules and expertise categories.",
    ],
    schedule: [
      "My consultation requests | CLSU FacultyConnect",
      "Review consultation request status, appointment details, and completed-session feedback.",
    ],
    assistant: [
      "Consult AI | CLSU FacultyConnect",
      "Ask questions using the approved CLSU consultation knowledge base.",
    ],
    profile: [
      "My profile | CLSU FacultyConnect",
      "Manage your FacultyConnect student profile and notification preferences.",
    ],
  };
  const defaultMetadata: [string, string] =
    pathname === "/privacy" ||
    pathname === "/privacy-policy" ||
    pathname === "/privacy-policy.html"
      ? [
          "Privacy Policy | CLSU FacultyConnect",
          "Learn how CLSU FacultyConnect collects, uses, protects, and retains consultation information.",
        ]
      : forgotPasswordPath
        ? [
            "Forgot password | CLSU FacultyConnect",
            "Request a secure FacultyConnect password recovery link.",
          ]
      : pathname !== "/"
        ? [
            "Page not found | CLSU FacultyConnect",
            "The requested FacultyConnect page could not be found.",
          ]
        : recoveringPassword
          ? [
              "Reset password | CLSU FacultyConnect",
              "Securely update your FacultyConnect account password.",
            ]
          : user?.role === "student"
            ? studentMetadata[view]
            : [
                "Secure portal | CLSU FacultyConnect",
                "Access CLSU faculty consultation scheduling, approved guidance, and role-protected services.",
              ];
  usePageMetadata(defaultMetadata[0], defaultMetadata[1]);
  useEffect(() => {
    if (!configured) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    const loadUser = async (id: string, email: string) => {
      const { data: p, error } = await supabase
        .from("profiles")
        .select(
          "full_name,role,department,student_number,college,program,year_level,email_notifications,account_status,status_reason",
        )
        .eq("id", id)
        .single();
      if (!active) return;
      if (error) {
        setNotice(
          "Your account exists, but its portal profile could not be loaded.",
        );
        setUser(null);
        return;
      }
      if (p.account_status && p.account_status !== "active") {
        setNotice(`This account is ${p.account_status}. ${p.status_reason || "Contact MISO for assistance."}`);
        setUser(null);
        await supabase.auth.signOut({ scope: "local" });
        return;
      }
      setUser({
        id,
        email,
        name: p.full_name,
        role: p.role as Role,
        department: p.department || "",
        student_number: p.student_number || "",
        college: p.college || "",
        program: p.program || "",
        year_level: p.year_level || "",
        email_notifications: p.email_notifications ?? true,
        account_status: p.account_status || "active",
      });
    };
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session)
        await loadUser(data.session.user.id, data.session.user.email || "");
      if (active) setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          setUser(null);
          setRecoveringPassword(false);
          setAuthLoading(false);
          void clearChatTrustSession();
        } else if (event === "PASSWORD_RECOVERY") {
          setRecoveringPassword(true);
          setAuthLoading(false);
          if (session) void loadUser(session.user.id, session.user.email || "");
        } else if (session)
          void loadUser(session.user.id, session.user.email || "");
      },
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!configured || !user || user.role !== "student") return;
    const refresh = () => void loadStudentData(user.id);
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    const channel = supabase
      .channel(`student-portal:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `student_id=eq.${user.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability",
        },
        refresh,
      )
      .subscribe();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, user?.role]);
  useEffect(() => {
    if (!configured || !user?.id) return;
    const heartbeat = () => {
      if (document.visibilityState !== "visible") return;
      void recordUserPresence(user.id).catch(() => {
        // Presence is operational metadata and must never interrupt portal use.
      });
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 45_000);
    const onVisibilityChange = () => heartbeat();
    window.addEventListener("focus", heartbeat);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", heartbeat);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!configured || !user?.id) return;
    const runtimeError = (event: ErrorEvent) => {
      void recordClientError(
        user.id,
        "runtime_error",
        event.message || "Unknown browser runtime error",
      ).catch(() => undefined);
    };
    const rejection = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error
        ? event.reason.message
        : String(event.reason || "Unhandled promise rejection");
      void recordClientError(user.id, "unhandled_rejection", message).catch(() => undefined);
    };
    window.addEventListener("error", runtimeError);
    window.addEventListener("unhandledrejection", rejection);
    return () => {
      window.removeEventListener("error", runtimeError);
      window.removeEventListener("unhandledrejection", rejection);
    };
  }, [user?.id]);
  async function loadStudentData(studentId: string) {
    try {
      const data = await loadStudentPortal(studentId);
      setSlots(
        data.slots.map((slot, i) => ({
          id: slot.id,
          faculty_name: slot.faculty_name,
          initials: slot.faculty_name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2),
          expertise: slot.expertise.join(", ") || "General consultation",
          subjects: slot.subjects,
          consultationTopics: slot.consultation_topics,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          location: slot.location,
          color: ["coral", "blue", "gold", "mint"][i % 4],
          booking_open: slot.booking_open,
        })),
      );
      setBooked(
        data.appointments.map((item) => ({
          id: item.availability_id,
          appointment_id: item.id,
          faculty_name: item.faculty_name,
          initials: item.faculty_name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2),
          expertise: item.expertise.join(", ") || "Consultation",
          subjects: [],
          consultationTopics: [],
          starts_at: item.starts_at,
          ends_at: item.ends_at,
          location: item.location,
          color: "mint",
          status: item.status,
          topic: item.topic,
          notes: item.notes,
          updated_at: item.updated_at,
          review: item.review,
          booking_open: false,
        })),
      );
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Student data could not be loaded.",
      );
    }
  }
  const filtered = useMemo(
    () =>
      slots.filter((s) =>
        (
          s.faculty_name +
          " " +
          s.expertise +
          " " +
          s.subjects.join(" ") +
          " " +
          s.consultationTopics.join(" ")
        )
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [slots, query],
  );
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice("");
    if (!configured) {
      setNotice(
        "The production database is not configured yet. Add the Supabase environment variables in Vercel.",
      );
      return;
    }
    if (!PRODUCTION_SECURITY_READY) {
      setNotice("Security verification is temporarily unavailable. Please contact MISO.");
      return;
    }
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    const captchaToken = String(f.get("captcha_token") || "");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) setNotice(friendlyAuthError(error.message, "login"));
  }
  async function signup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice("");
    if (!configured) {
      setNotice(
        "The production database is not configured yet. Add the Supabase environment variables in Vercel.",
      );
      return;
    }
    if (!PRODUCTION_SECURITY_READY) {
      setNotice("Security verification is temporarily unavailable. Please contact MISO.");
      return;
    }
    const f = new FormData(e.currentTarget);
    const full_name = String(f.get("full_name")).trim();
    const student_number = String(f.get("student_number")).trim();
    const college = String(f.get("college")).trim();
    const program = String(f.get("program")).trim();
    const year_level = String(f.get("year_level")).trim();
    const email = String(f.get("email")).trim().toLowerCase();
    const password = String(f.get("password"));
    const confirmation = String(f.get("confirmation"));
    const privacyAcknowledged = f.get("privacy_acknowledged") === "on";
    const captchaToken = String(f.get("captcha_token") || "");
    if (full_name.length < 3) {
      setNotice("Enter your complete name as it appears in your student record.");
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{3,29}$/.test(student_number)) {
      setNotice(
        "Enter a valid student number using 4–30 letters, numbers, spaces, or hyphens.",
      );
      return;
    }
    if (!college || !program || !year_level) {
      setNotice("Complete your college or unit, degree program, and year level.");
      return;
    }
    if (!isAllowedStudentEmail(email)) {
      setNotice("Use an email address ending in @gmail.com or @clsu2.edu.ph.");
      return;
    }
    if (!studentPasswordIsValid(password)) {
      setNotice(
        "Your password must meet every requirement shown below the password field.",
      );
      return;
    }
    if (password !== confirmation) {
      setNotice("The password confirmation does not match.");
      return;
    }
    if (!privacyAcknowledged) {
      setNotice(
        "Confirm that your information is accurate and may be used to manage consultation requests.",
      );
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken: captchaToken || undefined,
        data: {
          full_name,
          student_number,
          college,
          program,
          year_level,
        },
      },
    });
    if (error) {
      setNotice(friendlyAuthError(error.message, "signup"));
      return;
    }
    setNotice(
      data.session
        ? "Your student account is ready."
        : "Account created. Check your email and select the confirmation link before signing in.",
    );
  }
  async function requestPasswordReset(email: string, captchaToken?: string) {
    setNotice("");
    if (!configured) {
      setNotice(
        "Password recovery requires the production Supabase configuration.",
      );
      return false;
    }
    if (!PRODUCTION_SECURITY_READY) {
      setNotice("Security verification is temporarily unavailable. Please contact MISO.");
      return false;
    }
    if (!email || !email.includes("@")) {
      setNotice("Enter your registered email address first.");
      return false;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
      captchaToken,
    });
    if (error) {
      setNotice(friendlyAuthError(error.message, "reset"));
      return false;
    }
    setNotice(
      "If a FacultyConnect account uses this address, a secure reset link has been sent.",
    );
    return true;
  }
  async function updateRecoveredPassword(password: string) {
    setNotice("");
    if (!studentPasswordIsValid(password)) {
      setNotice("Your new password must meet every requirement.");
      return false;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setNotice(error.message);
      return false;
    }
    setRecoveringPassword(false);
    setNotice("Your password has been updated.");
    return true;
  }
  async function logout() {
    if (configured && user?.id) {
      await recordUserPresence(user.id, false).catch(() => undefined);
    }
    setUser(null);
    setView("home");
    setNotice("");
    await clearChatTrustSession();
    if (configured) await supabase.auth.signOut({ scope: "local" });
  }
  async function saveStudentProfile(values: {
    fullName: string;
    college: string;
    program: string;
    yearLevel: string;
    emailNotifications: boolean;
  }) {
    if (!user) return false;
    setNotice("");
    const fullName = values.fullName.trim();
    const college = values.college.trim();
    const program = values.program.trim();
    const yearLevel = values.yearLevel.trim();
    const validYearLevels = new Set([
      "1st year",
      "2nd year",
      "3rd year",
      "4th year",
      "5th year or higher",
      "Graduate student",
    ]);
    if (fullName.length < 3 || fullName.length > 120) {
      setNotice("Enter your complete name using 3 to 120 characters.");
      return false;
    }
    if (!college || college.length > 120 || !program || program.length > 120) {
      setNotice("Enter a valid college or unit and degree program.");
      return false;
    }
    if (!validYearLevels.has(yearLevel)) {
      setNotice("Choose a valid year level.");
      return false;
    }
    if (configured) {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          college,
          program,
          year_level: yearLevel,
          department:
            [program, yearLevel].filter(Boolean).join(" · ") ||
            null,
          email_notifications: values.emailNotifications,
        })
        .eq("id", user.id);
      if (error) {
        setNotice(error.message);
        return false;
      }
    }
    setUser({
      ...user,
      name: fullName,
      college,
      program,
      year_level: yearLevel,
      department: [program, yearLevel].filter(Boolean).join(" · "),
      email_notifications: values.emailNotifications,
      account_status: user.account_status,
    });
    setNotice("Profile has been updated.");
    return true;
  }
  async function confirmBook() {
    if (!user || !selected || submitting) return;
    const slot = selected;
    const topic = bookingTopic.trim();
    if (!topic) {
      setNotice(
        "Please describe the consultation topic before submitting the request.",
      );
      return;
    }
    setSubmitting(true);
    try {
      if (reschedulingId) {
        await rescheduleAppointment(reschedulingId, slot.id);
        setNotice(
          `Your request was moved to ${slot.faculty_name}'s published time and is pending approval.`,
        );
      } else {
        await bookAppointment({ slotId: slot.id, topic, notes: topic });
        setNotice(
          `Request sent to ${slot.faculty_name}. Email updates will be sent to ${user.email}.`,
        );
      }
      await loadStudentData(user.id);
      setSelected(null);
      setBookingTopic("");
      setReschedulingId(null);
      setView("schedule");
    } catch (cause) {
      void recordClientError(
        user.id,
        "booking_error",
        cause instanceof Error ? cause.message : "Consultation booking failed",
      ).catch(() => undefined);
      setNotice(
        cause instanceof Error
          ? cause.message
          : "The request could not be submitted.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function cancelRequest(appointmentId: string) {
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      await cancelAppointment(appointmentId);
      setNotice(
        "The consultation was cancelled and both participants were queued for an email update.",
      );
      await loadStudentData(user.id);
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "The request could not be cancelled.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function saveConsultationReview(
    appointmentId: string,
    rating: number,
    comment: string,
  ) {
    if (!user || submitting) return false;
    setSubmitting(true);
    try {
      await submitConsultationReview({ appointmentId, rating, comment });
      setNotice("Thank you. Your consultation review has been recorded.");
      await loadStudentData(user.id);
      return true;
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Your consultation review could not be submitted.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  }
  function beginReschedule(slot: Slot) {
    if (!slot.appointment_id) return;
    setReschedulingId(slot.appointment_id);
    setBookingTopic(slot.topic || "");
    setView("find");
    setNotice(
      "Choose a different published time. Your current request remains active until the replacement succeeds.",
    );
  }
  async function ask(e: FormEvent, captchaToken?: string): Promise<ChatAskResult> {
    e.preventDefault();
    const q = question.trim();
    if (!q) return "error";
    setQuestion("");
    setChat((c) => [...c, { who: "you", text: q }]);
    try {
      const d = await requestChatbotReply(q, captchaToken);
      setChat((c) => [
        ...c,
        {
          who: "bot",
          text: d.answer,
          source: d.source,
          escalation: Boolean(d.escalation),
          suggestions: d.suggestions || [],
        },
      ]);
      return "ok";
    } catch (cause) {
      const challengeRequired =
        cause instanceof ChatbotRequestError &&
        (cause.status === 403 || cause.status === 429);
      if (!challengeRequired && user) {
        void recordClientError(
          user.id,
          "chatbot_error",
          cause instanceof Error ? cause.message : "Chatbot request failed",
        ).catch(() => undefined);
      }
      setChat((c) => [
        ...c,
        {
          who: "bot",
          text: "The assistant is temporarily offline. Please use the official CLIRDEC contact channel or try again later.",
          escalation: true,
        },
      ]);
      return challengeRequired ? "challenge" : "error";
    }
  }
  if (
    pathname === "/privacy" ||
    pathname === "/privacy-policy" ||
    pathname === "/privacy-policy.html"
  )
    return <PrivacyPolicyPage />;
  if (forgotPasswordPath)
    return (
      <ForgotPasswordPage
        send={requestPasswordReset}
        notice={notice}
        clearNotice={() => setNotice("")}
      />
    );
  if (pathname !== "/") return <NotFoundPage />;
  if (authLoading)
    return (
      <main className="auth-loading" id="main-content">
        <PortalLoader
          label="Opening FacultyConnect"
          detail="Checking your secure session and portal access."
        />
      </main>
    );
  if (recoveringPassword)
    return <PasswordRecovery save={updateRecoveredPassword} notice={notice} />;
  if (!user)
    return (
      <ProductionAuth
        login={login}
        signup={signup}
        clearNotice={() => setNotice("")}
        notice={notice}
      />
    );
  if (user.role !== "student")
    return (
      <PrivilegedMfaGate onSignOut={logout}>
        <RoleWorkspace user={user} logout={logout} />
      </PrivilegedMfaGate>
    );
  const nav = (next: View) => {
    setView(next);
    setMenu(false);
    setNotice("");
    if (next !== "find") {
      setReschedulingId(null);
      setBookingTopic("");
    }
  };
  const studentNotifications: NotificationAppointment[] = booked
    .filter((item) => Boolean(item.status))
    .map((item) => ({
      id: item.appointment_id || item.id,
      status: item.status!,
      updated_at: item.updated_at || item.starts_at,
      starts_at: item.starts_at,
      faculty_name: item.faculty_name,
      student_name: user.name,
      topic: item.topic || item.expertise,
      location: item.location,
    }));
  return (
    <div className="app student-app">
      <SkipLink />
      <header className="topbar">
        <button type="button" className="brand-button" onClick={() => nav("home")}>
          <BrandLogo />
          <span>
            <b>CLSU FacultyConnect</b>
            <small>Faculty consultation and verified guidance</small>
          </span>
        </button>
        <div className="top-actions">
          <NotificationCenter
            user={user}
            studentAppointments={studentNotifications}
            onNavigate={(target) => nav(target as View)}
          />
          <button
            type="button"
            className="profile-chip"
            onClick={() => nav("profile")}
            aria-label="Open my profile"
          >
            <span>
              {user.name
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)}
            </span>
            <i>
              <b>{user.name}</b>
              <small>Student</small>
            </i>
          </button>
          <button
            type="button"
            className="menu-button"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle menu"
            aria-expanded={menu}
          >
            ☰
          </button>
        </div>
      </header>
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <nav>
          <Nav
            active={view === "home"}
            label="Overview"
            icon="home"
            onClick={() => nav("home")}
          />
          <Nav
            active={view === "assistant"}
            label="Consult AI"
            icon="assistant"
            onClick={() => nav("assistant")}
          />
          <Nav
            active={view === "find"}
            label="Faculty availability"
            icon="search"
            onClick={() => nav("find")}
          />
          <Nav
            active={view === "schedule"}
            label="My requests"
            icon="requests"
            onClick={() => nav("schedule")}
          />
          <Nav
            active={view === "profile"}
            label="My profile"
            icon="profile"
            onClick={() => nav("profile")}
          />
        </nav>
        <div className="side-foot">
          <span>CLIRDEC</span>
          <small>Official service · Approved content only</small>
          <PortalFooterActions onLogout={logout} />
        </div>
      </aside>
      <main id="main-content" className={`content student-content view-${view}`}>
        {notice && (
          <div className="notice" role="status" aria-live="polite">
            <b>✓</b>
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {view === "home" && <Dashboard user={user} booked={booked} go={nav} />}{" "}
        {view === "find" && (
          <FindFaculty
            query={query}
            setQuery={setQuery}
            slots={filtered}
            select={setSelected}
          />
        )}{" "}
        {view === "schedule" && (
          <Schedule
            booked={booked}
            cancel={cancelRequest}
            reschedule={beginReschedule}
            busy={submitting}
            emailNotifications={user.email_notifications}
            review={saveConsultationReview}
          />
        )}{" "}
        {view === "assistant" && (
          <Chat
            chat={chat}
            question={question}
            setQuestion={setQuestion}
            ask={ask}
          />
        )}{" "}
        {view === "profile" && (
          <StudentProfile user={user} save={saveStudentProfile} />
        )}
      </main>
      <MobilePortalNav
        active={view}
        navigate={(target) => nav(target as View)}
        items={[
          ["home", "Overview", "home"],
          ["assistant", "Ask AI", "assistant"],
          ["find", "Faculty", "search"],
          ["schedule", "Requests", "requests"],
          ["profile", "Profile", "profile"],
        ]}
      />
      {selected && (
        <BookingModal
          slot={selected}
          topic={bookingTopic}
          setTopic={setBookingTopic}
          close={() => {
            setSelected(null);
            setReschedulingId(null);
            setBookingTopic("");
          }}
          confirm={confirmBook}
          submitting={submitting}
          rescheduling={Boolean(reschedulingId)}
        />
      )}
    </div>
  );
}

const studentPasswordRules = [
  {
    id: "length",
    label: "At least 8 characters",
    test: (value: string) => value.length >= 8,
  },
  {
    id: "uppercase",
    label: "One uppercase letter",
    test: (value: string) => /[A-Z]/.test(value),
  },
  {
    id: "lowercase",
    label: "One lowercase letter",
    test: (value: string) => /[a-z]/.test(value),
  },
  {
    id: "number",
    label: "One number",
    test: (value: string) => /\d/.test(value),
  },
  {
    id: "symbol",
    label: "One symbol (for example: ! @ # $ %)",
    test: (value: string) => /[^A-Za-z0-9\s]/.test(value),
  },
] as const;
function studentPasswordIsValid(value: string) {
  return studentPasswordRules.every((rule) => rule.test(value));
}
function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {visible ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.8 10.8 0 0 1 12 4c5.2 0 9 4.7 9 8a8.5 8.5 0 0 1-2.1 3.9M6.6 6.6C4.3 8 3 10.3 3 12c0 3.3 3.8 8 9 8 1.1 0 2.2-.2 3.1-.6" />
        </>
      ) : (
        <>
          <path d="M3 12c0-3.3 3.8-8 9-8s9 4.7 9 8-3.8 8-9 8-9-4.7-9-8Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )}
    </svg>
  );
}
function ProductionAuth({
  login,
  signup,
  clearNotice,
  notice,
}: {
  login: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  signup: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  clearNotice: () => void;
  notice: string;
}) {
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submittingAuth, setSubmittingAuth] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaGeneration, setCaptchaGeneration] = useState(0);
  usePageMetadata(
    creating
      ? "Create student account | CLSU FacultyConnect"
      : "Sign in | CLSU FacultyConnect",
    creating
      ? "Create an approved CLSU FacultyConnect student account."
      : "Sign in securely to the CLSU FacultyConnect student, faculty, or administrator portal.",
  );
  const passwordValid = studentPasswordIsValid(password);
  const passwordsMatch = confirmation.length > 0 && password === confirmation;
  const noticeIsSuccess = /account (created|is ready)|check your email|reset link/i.test(
    notice,
  );
  const passedRuleCount = studentPasswordRules.filter((rule) =>
    rule.test(password),
  ).length;
  const changeMode = () => {
    setCreating((value) => !value);
    setPassword("");
    setConfirmation("");
    setPasswordVisible(false);
    setCaptchaToken("");
    setCaptchaGeneration((value) => value + 1);
    clearNotice();
  };
  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    setSubmittingAuth(true);
    try {
      await (creating ? signup(event) : login(event));
    } finally {
      setSubmittingAuth(false);
      setCaptchaToken("");
      setCaptchaGeneration((value) => value + 1);
    }
  };
  return (
    <main className="auth" id="main-content">
      <SkipLink />
      <section className="auth-story">
        <div className="public-brand">
          <BrandLogo tone="light" size="hero" />
          <span>CLSU FacultyConnect</span>
        </div>
        <div>
          <span className="service-label">CLSU FACULTY CONNECT</span>
          <h1>Approved answers. Clear next steps.</h1>
          <p>
            Use your registered email to access faculty consultation services
            and verified CLIRDEC guidance.
          </p>
          <ul>
            <li>Role-protected student, faculty, and administrator portals</li>
            <li>Faculty-approved schedules and request decisions</li>
            <li>Email updates for important appointment events</li>
          </ul>
        </div>
        <small>
          Central Luzon State University · Nurturing a Culture of Excellence
        </small>
      </section>
      <section className="auth-panel">
        <form
          className={creating ? "login student-signup" : "login"}
          onSubmit={submitAuth}
        >
          <span className="mobile-brand">
            <BrandLogo />
            <span>CLSU FacultyConnect</span>
          </span>
          <p className="eyebrow">SECURE PORTAL</p>
          {creating ? (
            <>
              <h1>Create a student account</h1>
              <p className="muted">
                Students may register with Gmail or their CLSU student email.
                Faculty and administrator accounts are issued separately by MISO.
              </p>
            </>
          ) : (
            <>
              <h1>Log in to your portal</h1>
              <p className="muted">
                Students, faculty, and administrators use the same secure
                sign-in.
              </p>
            </>
          )}
          {notice && (
            <div
              className={
                noticeIsSuccess ? "form-notice success" : "form-notice error"
              }
              role={noticeIsSuccess ? "status" : "alert"}
            >
              <b>
                {noticeIsSuccess ? "Success" : "Please check your information"}
              </b>
              <span>{notice}</span>
            </div>
          )}
          {!PRODUCTION_SECURITY_READY && (
            <div className="form-notice error" role="alert">
              <b>Security verification unavailable</b>
              <span>Authentication is paused until MISO restores the security check.</span>
            </div>
          )}
          {creating ? (
            <div className="signup-fields">
              <label>
                Full name
                <input
                  name="full_name"
                  required
                  minLength={3}
                  maxLength={100}
                  autoComplete="name"
                  placeholder="Juan Dela Cruz"
                />
                <small>Use the name shown in your student record.</small>
              </label>
              <label>
                Student number
                <input
                  name="student_number"
                  required
                  minLength={4}
                  maxLength={30}
                  pattern="[A-Za-z0-9][A-Za-z0-9 -]{3,29}"
                  title="Use 4–30 letters, numbers, spaces, or hyphens."
                  autoComplete="off"
                  placeholder="22-1234"
                />
                <small>Enter the number on your CLSU student ID.</small>
              </label>
              <label>
                College or unit
                <input
                  name="college"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="organization"
                  placeholder="College of Engineering"
                />
              </label>
              <label>
                Degree program
                <input
                  name="program"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="BS Information Technology"
                />
              </label>
              <label>
                Year level
                <select name="year_level" required defaultValue="">
                  <option value="" disabled>
                    Select your year level
                  </option>
                  <option value="1st year">1st year</option>
                  <option value="2nd year">2nd year</option>
                  <option value="3rd year">3rd year</option>
                  <option value="4th year">4th year</option>
                  <option value="5th year or higher">5th year or higher</option>
                  <option value="Graduate student">Graduate student</option>
                </select>
              </label>
              <label>
                Student email address
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="name@clsu2.edu.ph"
                  aria-describedby="student-email-guidance"
                />
                <small id="student-email-guidance">
                  Accepted domains: @gmail.com and @clsu2.edu.ph. You must
                  confirm the address before signing in.
                </small>
              </label>
            </div>
          ) : (
            <label>
              Email address
              <input name="email" type="email" required autoComplete="email" />
            </label>
          )}
          <div className="auth-field password-label">
            <label htmlFor="portal-password">Password</label>
            <span className="password-field">
              <input
                id="portal-password"
                name="password"
                type={passwordVisible ? "text" : "password"}
                required
                minLength={8}
                autoComplete={creating ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={
                  creating
                    ? "student-password-rules student-password-progress"
                    : undefined
                }
                aria-invalid={creating && password.length > 0 && !passwordValid}
              />
              <button
                type="button"
                className="password-visibility"
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((value) => !value)}
              >
                <PasswordVisibilityIcon visible={passwordVisible} />
                <span>{passwordVisible ? "Hide" : "Show"}</span>
              </button>
            </span>
          </div>
          {creating && (
            <>
              <div
                className={
                  passwordVisible
                    ? "password-privacy visible"
                    : "password-privacy"
                }
                role="status"
              >
                <span aria-hidden="true">{passwordVisible ? "👁" : "🛡"}</span>
                <p>
                  <b>
                    {passwordVisible
                      ? "Your password is visible"
                      : "Your password is hidden"}
                  </b>
                  <small>
                    {passwordVisible
                      ? "Make sure no one else can see your screen."
                      : "Select Show whenever you need to check what you typed."}
                  </small>
                </p>
              </div>
              <p
                id="student-password-progress"
                className="sr-only"
                aria-live="polite"
              >
                {passedRuleCount} of {studentPasswordRules.length} password
                requirements met.
              </p>
              <ul
                className="password-rules"
                id="student-password-rules"
                aria-label="Password requirements"
              >
                {studentPasswordRules.map((rule) => {
                  const passed = rule.test(password);
                  return (
                    <li key={rule.id} className={passed ? "passed" : ""}>
                      <span aria-hidden="true">{passed ? "✓" : "·"}</span>
                      {rule.label}
                    </li>
                  );
                })}
              </ul>
              <div className="auth-field">
                <label htmlFor="portal-password-confirmation">
                  Confirm password
                </label>
                <span className="password-field">
                  <input
                    id="portal-password-confirmation"
                    name="confirmation"
                    type={passwordVisible ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    aria-describedby="password-match-status"
                    aria-invalid={confirmation.length > 0 && !passwordsMatch}
                  />
                </span>
              </div>
              <p
                id="password-match-status"
                className={
                  confirmation.length === 0
                    ? "password-match neutral"
                    : passwordsMatch
                      ? "password-match passed"
                      : "password-match"
                }
                aria-live="polite"
              >
                {confirmation.length === 0
                  ? "Re-enter your password to confirm it."
                  : passwordsMatch
                    ? "✓ Passwords match."
                    : "Passwords do not match yet."}
              </p>
              <label className="privacy-confirmation">
                <input name="privacy_acknowledged" type="checkbox" required />
                <span>
                  I confirm that the information above is accurate and may be
                  used to identify me and manage my consultation requests.
                </span>
              </label>
            </>
          )}
          {TURNSTILE_SITE_KEY && (
            <div className={`turnstile-field${captchaToken ? " is-complete" : ""}`}>
              <div className="turnstile-widget-shell" aria-hidden={Boolean(captchaToken)}>
                <Turnstile
                  key={captchaGeneration}
                  siteKey={TURNSTILE_SITE_KEY}
                  options={{ theme: "light", size: "flexible", action: creating ? "student_signup" : "portal_login" }}
                  onSuccess={setCaptchaToken}
                  onExpire={() => setCaptchaToken("")}
                  onError={() => setCaptchaToken("")}
                />
              </div>
              {captchaToken && (
                <p className="turnstile-confirmed" role="status">
                  <span aria-hidden="true">✓</span>
                  Security check complete
                </p>
              )}
              <input type="hidden" name="captcha_token" value={captchaToken} />
            </div>
          )}
          <button
            className="primary"
            aria-busy={submittingAuth}
            disabled={
              submittingAuth ||
              !PRODUCTION_SECURITY_READY ||
              (Boolean(TURNSTILE_SITE_KEY) && !captchaToken) ||
              (creating && (!passwordValid || !passwordsMatch))
            }
          >
            {submittingAuth
              ? <ButtonLoading label={creating ? "Creating account" : "Signing in"} />
              : creating
                ? "Create student account"
                : "Log in"}
          </button>
          <div className="auth-options">
            {!creating && (
              <a
                className="auth-option"
                href="/forgot-password"
              >
                <b>Forgot your password?</b>
                <small>
                  Open the dedicated recovery page to request a secure link.
                </small>
              </a>
            )}
            <button type="button" className="auth-option" onClick={changeMode}>
              <b>
                {creating
                  ? "Already registered? Sign in"
                  : "Create a student account"}
              </b>
              <small>
                {creating
                  ? "Return to the secure portal login."
                  : "For students who need to request faculty consultations."}
              </small>
            </button>
          </div>
          {!creating && (
            <aside className="account-type-list" aria-label="Account types">
              <p>ACCOUNT TYPES</p>
              <div>
                <b>Student</b>
                <span>Self-register and request consultations.</span>
              </div>
              <div>
                <b>Faculty</b>
                <span>MISO-issued account for schedules and requests.</span>
              </div>
              <div>
                <b>Administrator</b>
                <span>Restricted MISO account for portal oversight.</span>
              </div>
            </aside>
          )}
          <div className="legal-links">
            <a className="legal-link-button" href="/privacy-policy">
              Privacy policy
            </a>
            <span>·</span>
            <span>Secure, role-protected access</span>
          </div>
        </form>
      </section>
      <div className="mobile-auth-cta">
        <button type="button" onClick={changeMode}>
          {creating ? "Return to sign in" : "Create a student account"}
        </button>
      </div>
    </main>
  );
}

function ForgotPasswordPage({
  send,
  notice,
  clearNotice,
}: {
  send: (email: string, captchaToken?: string) => Promise<boolean>;
  notice: string;
  clearNotice: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [sending, setSending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaGeneration, setCaptchaGeneration] = useState(0);
  usePageMetadata(
    "Forgot password | CLSU FacultyConnect",
    "Request a secure FacultyConnect password recovery link.",
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const sent = await send(normalizedEmail, captchaToken || undefined);
      if (sent) setSentTo(normalizedEmail);
    } finally {
      setSending(false);
      setCaptchaToken("");
      setCaptchaGeneration((value) => value + 1);
    }
  };
  const tryAnotherAddress = () => {
    setSentTo("");
    setEmail("");
    setCaptchaToken("");
    setCaptchaGeneration((value) => value + 1);
    clearNotice();
  };
  return (
    <main className="auth auth-recovery-request" id="main-content">
      <SkipLink />
      <section className="auth-story recovery-story">
        <div className="public-brand">
          <BrandLogo tone="light" size="hero" />
          <span>CLSU FacultyConnect</span>
        </div>
        <div>
          <span className="service-label">SECURE ACCOUNT RECOVERY</span>
          <h1>Let’s get you back into your portal.</h1>
          <p>
            Enter the email address attached to your account. We will send a
            time-limited link that lets you choose a new password securely.
          </p>
          <ol className="recovery-steps" aria-label="Password recovery steps">
            <li><b>1</b><span>Request a secure link</span></li>
            <li><b>2</b><span>Check your email</span></li>
            <li><b>3</b><span>Create a new password</span></li>
          </ol>
        </div>
        <small>
          FacultyConnect never asks you to send your password by email.
        </small>
      </section>
      <section className="auth-panel recovery-panel">
        <form className="login recovery-request-card" onSubmit={submit}>
          <span className="mobile-brand">
            <BrandLogo />
            <span>CLSU FacultyConnect</span>
          </span>
          <p className="eyebrow">PASSWORD RECOVERY</p>
          {sentTo ? (
            <>
              <div className="recovery-success-symbol" aria-hidden="true">✓</div>
              <h1>Check your inbox</h1>
              <p className="muted">
                If a FacultyConnect account uses <b>{sentTo}</b>, a secure
                password-reset link is on its way.
              </p>
              <div className="recovery-guidance" role="status" aria-live="polite">
                <b>Link requested successfully</b>
                <span>The link expires for your protection. Open only the latest recovery email.</span>
              </div>
              <div className="recovery-actions">
                <a className="primary recovery-link-button" href="/">Return to sign in</a>
                <button type="button" className="outline" onClick={tryAnotherAddress}>
                  Try another email
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>Reset your password</h1>
              <p className="muted">
                Use your registered Gmail or CLSU email address.
              </p>
              {notice && (
                <div className="form-notice error" role="alert">
                  <b>We could not send the link</b>
                  <span>{notice}</span>
                </div>
              )}
              <label htmlFor="recovery-email-request">
                Registered email address
                <input
                  id="recovery-email-request"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="name@clsu2.edu.ph"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <small>We show the same response whether or not an account exists.</small>
              </label>
              {TURNSTILE_SITE_KEY && (
                <div className={`turnstile-field${captchaToken ? " is-complete" : ""}`}>
                  <div className="turnstile-widget-shell" aria-hidden={Boolean(captchaToken)}>
                    <Turnstile
                      key={captchaGeneration}
                      siteKey={TURNSTILE_SITE_KEY}
                      options={{ theme: "light", size: "flexible", action: "password_recovery" }}
                      onSuccess={setCaptchaToken}
                      onExpire={() => setCaptchaToken("")}
                      onError={() => setCaptchaToken("")}
                    />
                  </div>
                  {captchaToken && (
                    <p className="turnstile-confirmed" role="status">
                      <span aria-hidden="true">✓</span>
                      Security check complete
                    </p>
                  )}
                </div>
              )}
              <button
                className="primary"
                aria-busy={sending}
                disabled={
                  sending ||
                  !PRODUCTION_SECURITY_READY ||
                  (Boolean(TURNSTILE_SITE_KEY) && !captchaToken)
                }
              >
                {sending ? <ButtonLoading label="Sending secure link" /> : "Send reset link"}
              </button>
              <a className="recovery-back-link" href="/">← Return to secure sign in</a>
            </>
          )}
          <aside className="recovery-fallback" aria-label="Recovery fallback options">
            <b>Still unable to recover your account?</b>
            <ul>
              <li>Check the Spam or Promotions folder.</li>
              <li>Confirm you entered the address used for FacultyConnect.</li>
              <li>Ask the authorized MISO administrator to verify your account status.</li>
            </ul>
          </aside>
          <div className="legal-links">
            <a className="legal-link-button" href="/privacy-policy">Privacy policy</a>
            <span>·</span>
            <span>Secure, role-protected recovery</span>
          </div>
        </form>
      </section>
    </main>
  );
}

function PasswordRecovery({
  save,
  notice,
}: {
  save: (password: string) => Promise<boolean>;
  notice: string;
}) {
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const valid = studentPasswordIsValid(password);
  const matches = confirmation.length > 0 && password === confirmation;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) {
      setLocalError("Your password must meet every requirement.");
      return;
    }
    if (!matches) {
      setLocalError("Passwords do not match.");
      return;
    }
    setLocalError("");
    setSaving(true);
    await save(password);
    setSaving(false);
  };
  return (
    <main className="auth" id="main-content">
      <SkipLink />
      <section className="auth-story">
        <div className="public-brand">
          <BrandLogo tone="light" size="hero" />
          <span>CLSU FacultyConnect</span>
        </div>
        <div>
          <span className="service-label">SECURE ACCOUNT RECOVERY</span>
          <h1>Choose a new password.</h1>
          <p>
            Your new password must meet the same security requirements used for
            registration.
          </p>
        </div>
      </section>
      <section className="auth-panel">
        <form className="login" onSubmit={submit}>
          <p className="eyebrow">PASSWORD RECOVERY</p>
          <h1>Set your new password</h1>
          <div className="auth-field">
            <label htmlFor="recovery-password">New password</label>
            <span className="password-field">
              <input
                id="recovery-password"
                name="password"
                type={passwordVisible ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="recovery-password-rules"
                aria-invalid={password.length > 0 && !valid}
              />
              <button
                type="button"
                className="password-visibility"
                aria-label={passwordVisible ? "Hide new password" : "Show new password"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((value) => !value)}
              >
                <PasswordVisibilityIcon visible={passwordVisible} />
                <span>{passwordVisible ? "Hide" : "Show"}</span>
              </button>
            </span>
          </div>
          <ul
            className="password-rules"
            id="recovery-password-rules"
            aria-label="Password requirements"
          >
            {studentPasswordRules.map((rule) => {
              const passed = rule.test(password);
              return (
                <li key={rule.id} className={passed ? "passed" : ""}>
                  <span aria-hidden="true">{passed ? "✓" : "·"}</span>
                  {rule.label}
                </li>
              );
            })}
          </ul>
          <div className="auth-field">
            <label htmlFor="recovery-password-confirmation">Confirm password</label>
            <span className="password-field">
              <input
                id="recovery-password-confirmation"
                name="confirmation"
                type={confirmationVisible ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-invalid={confirmation.length > 0 && !matches}
              />
              <button
                type="button"
                className="password-visibility"
                aria-label={confirmationVisible ? "Hide confirmation password" : "Show confirmation password"}
                aria-pressed={confirmationVisible}
                onClick={() => setConfirmationVisible((value) => !value)}
              >
                <PasswordVisibilityIcon visible={confirmationVisible} />
                <span>{confirmationVisible ? "Hide" : "Show"}</span>
              </button>
            </span>
          </div>
          <button
            className="primary"
            aria-busy={saving}
            disabled={saving || !valid || !matches}
          >
            {saving ? <ButtonLoading label="Updating password" /> : "Update password"}
          </button>
          {(localError || notice) && (
            <p className="error" aria-live="polite">
              {localError || notice}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
function PrivacyPolicyPage() {
  return (
    <main className="public-policy-page" id="main-content">
      <SkipLink />
      <header className="public-policy-header">
        <a className="public-brand" href="/">
          <BrandLogo tone="light" size="hero" />
          <span>CLSU FacultyConnect</span>
        </a>
        <div>
          <p className="eyebrow">PRIVACY AND DATA PROTECTION</p>
          <h1>Privacy Policy</h1>
          <p>
            How FacultyConnect handles information used for faculty
            consultations, service administration, and quality improvement.
          </p>
          <small>Effective August 12, 2026</small>
        </div>
      </header>
      <section className="policy-layout">
        <nav aria-label="Privacy policy sections">
          <a href="#information">Information collected</a>
          <a href="#use">How information is used</a>
          <a href="#access">Access and sharing</a>
          <a href="#reviews">Consultation reviews</a>
          <a href="#security">Security and retention</a>
          <a href="#choices">Your choices</a>
        </nav>
        <article className="policy-copy">
          <section id="information">
            <h2>Information we collect</h2>
            <p>
              FacultyConnect stores the account information needed to identify
              authorized users, including name, registered email address,
              student number, college or unit, degree program, year level, role,
              and notification preferences. Consultation records include the
              requested topic, notes, faculty member, schedule, mode, location,
              and request status.
            </p>
          </section>
          <section id="use">
            <h2>How information is used</h2>
            <p>
              Information is used to authenticate users, match consultation
              requests with faculty-published schedules, communicate status
              updates, provide approved guidance, prevent scheduling conflicts,
              maintain operational records, and evaluate service quality.
            </p>
          </section>
          <section id="access">
            <h2>Access and sharing</h2>
            <p>
              Students can access their own requests. Faculty members can access
              requests assigned to their schedules. Authorized MISO
              administrators can access records required for support, quality
              assurance, security, and account administration. FacultyConnect
              does not sell personal information.
            </p>
          </section>
          <section id="reviews">
            <h2>Consultation reviews</h2>
            <p>
              After a completed consultation, students may provide a one-to-five
              star rating and an optional written comment. Administrators can
              review comments and aggregated results by year level, college, and
              course to improve the service. Demographic values are recorded as
              a snapshot at the time of review so historical reports remain
              accurate.
            </p>
          </section>
          <section id="security">
            <h2>Security and retention</h2>
            <p>
              Role-based access, database row-level security, secure account
              authentication, audit records, and encrypted network connections
              protect portal data. Records are retained only for as long as
              required for consultation operations, accountability, academic
              support, and applicable university requirements.
            </p>
          </section>
          <section id="choices">
            <h2>Your choices and questions</h2>
            <p>
              Users may update supported profile details and optional email
              notifications from the portal. Requests to correct or review other
              personal information should be directed to MISO or the authorized
              FacultyConnect administrator through official CLSU channels.
            </p>
          </section>
          <footer>
            <a className="primary" href="/">Return to FacultyConnect</a>
          </footer>
        </article>
      </section>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="not-found-page" id="main-content">
      <SkipLink />
      <section>
        <a className="public-brand" href="/">
          <BrandLogo tone="light" size="hero" />
          <span>CLSU FacultyConnect</span>
        </a>
        <div className="not-found-code">404</div>
        <p className="eyebrow">PAGE NOT FOUND</p>
        <h1>This page is not available.</h1>
        <p>
          The address may be incorrect, or the page may have moved. Return to
          the secure FacultyConnect portal to continue.
        </p>
        <a className="primary" href="/">Return to the portal →</a>
      </section>
    </main>
  );
}
function BrandLogo({
  tone = "dark",
  size = "header",
}: {
  tone?: "dark" | "light";
  size?: "header" | "hero";
}) {
  return (
    <img
      className={`brand-logo brand-logo-${size}`}
      src={tone === "light" ? "/brand/Logo_white.png" : "/brand/Logo_Black.png"}
      alt=""
      aria-hidden="true"
    />
  );
}
type NavIconName =
  | "home"
  | "assistant"
  | "search"
  | "requests"
  | "calendar"
  | "profile"
  | "users"
  | "report";
function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, ReactNode> = {
    home: (
      <>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6" />
      </>
    ),
    assistant: (
      <>
        <path d="M12 3 13.7 8.3 19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
        <path d="m19 17 .8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    requests: (
      <>
        <path d="M6 3.5h12a2 2 0 0 1 2 2v15H4v-15a2 2 0 0 1 2-2Z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 18h3M14 18h3" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
      </>
    ),
    report: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
  };
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Nav({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: NavIconName;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "nav-item active" : "nav-item"}
      onClick={onClick}
    >
      <NavIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}
function PortalFooterActions({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="side-foot-actions">
      <a className="side-action side-action-privacy" href="/privacy-policy">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 20 6v5c0 5.2-3.3 8.6-8 10-4.7-1.4-8-4.8-8-10V6l8-3Z" />
          <path d="M9.5 12 11 13.5l3.8-4" />
        </svg>
        <span>Privacy policy</span>
      </a>
      <button
        className="side-action side-action-signout"
        type="button"
        onClick={onLogout}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
        </svg>
        <span>Sign out</span>
      </button>
    </div>
  );
}
function MobilePortalNav({
  active,
  items,
  navigate,
}: {
  active: string;
  items: Array<[string, string, NavIconName]>;
  navigate: (target: string) => void;
}) {
  return (
    <nav className="mobile-portal-nav" aria-label="Mobile portal navigation">
      {items.map(([target, label, icon]) => (
        <button
          type="button"
          key={target}
          className={active === target ? "active" : ""}
          aria-current={active === target ? "page" : undefined}
          onClick={() => navigate(target)}
        >
          <NavIcon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
function statusLabel(status: AppointmentStatus = "pending") {
  return (
    {
      pending: "Pending faculty approval",
      confirmed: "Confirmed",
      completed: "Completed",
      cancelled: "Cancelled",
      declined: "Declined",
    } as Record<AppointmentStatus, string>
  )[status];
}
function Dashboard({
  user,
  booked,
  go,
}: {
  user: User;
  booked: Slot[];
  go: (v: View) => void;
}) {
  const next = booked[0];
  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">VERIFIED CONSULTATION GUIDANCE</p>
          <h1>What do you need help with, {user.name.split(" ")[0]}?</h1>
          <p>
            Start with the approved-information assistant or view
            faculty-maintained availability.
          </p>
        </div>
        <button className="primary" onClick={() => go("assistant")}>
          Consult AI <span>→</span>
        </button>
      </section>
      <section className="overview-grid">
        <article className="next-card">
          <div className="section-label">
            <span>LATEST CONSULTATION REQUEST</span>
            {next && <b>{statusLabel(next.status)}</b>}
          </div>
          {next ? (
            <>
              <div className="appointment-date">
                <strong>{new Date(next.starts_at).getDate()}</strong>
                <span>
                  {formatManilaDateTime(new Date(next.starts_at), {
                    month: "short",
                  }).toUpperCase()}
                  <br />
                  {formatManilaDateTime(new Date(next.starts_at), {
                    weekday: "short",
                  })}
                </span>
              </div>
              <div className="appointment-main">
                <span className={`avatar ${next.color}`}>{next.initials}</span>
                <div>
                  <h3>{next.topic || next.expertise}</h3>
                  <p>{next.faculty_name}</p>
                  <small>
                    Requested time:{" "}
                    {formatManilaDateTime(new Date(next.starts_at), {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    Philippine time
                  </small>
                </div>
              </div>
              <button className="text-button" onClick={() => go("schedule")}>
                View request status →
              </button>
            </>
          ) : (
            <div className="empty">
              <b>No active request</b>
              <p>
                Availability shown in the portal is faculty-approved, but a
                request still requires faculty confirmation.
              </p>
            </div>
          )}
        </article>
        <article className="quick-card">
          <span className="section-label">APPROVED GUIDANCE</span>
          <button onClick={() => go("assistant")}>
            <span className="quick-icon">✦</span>
            <i>
              <b>Consult AI</b>
              <small>FAQs, services, procedures, hours, and contacts</small>
            </i>
            <strong>→</strong>
          </button>
          <button onClick={() => go("find")}>
            <span className="quick-icon">⌕</span>
            <i>
              <b>View faculty availability</b>
              <small>Use approved categories and published schedules</small>
            </i>
            <strong>→</strong>
          </button>
        </article>
      </section>
      <section className="how">
        <div className="section-title">
          <div>
            <p className="eyebrow">SAFE BY DESIGN</p>
            <h2>Approved answer or official referral</h2>
          </div>
          <p>The assistant does not provide unrestricted generative answers.</p>
        </div>
        <div className="steps">
          <article>
            <b>01</b>
            <span>✦</span>
            <h3>Ask naturally</h3>
            <p>
              Use English, Filipino, mixed language, or common abbreviations.
            </p>
          </article>
          <article>
            <b>02</b>
            <span>?</span>
            <h3>Clarify when needed</h3>
            <p>
              The assistant asks one clarifying question when confidence is low.
            </p>
          </article>
          <article>
            <b>03</b>
            <span>↗</span>
            <h3>Refer safely</h3>
            <p>
              Unsupported or sensitive concerns go to an official staff channel.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
function FindFaculty({
  query,
  setQuery,
  slots,
  select,
}: {
  query: string;
  setQuery: (s: string) => void;
  slots: Slot[];
  select: (s: Slot) => void;
}) {
  return (
    <>
      <section className="page-head compact">
        <div>
          <p className="eyebrow">APPROVED CONSULTATION GUIDANCE</p>
          <h1>Faculty availability</h1>
          <p>
            Browse faculty-maintained schedules and approved expertise
            categories. The system does not automatically assign a faculty
            member.
          </p>
        </div>
      </section>
      <div className="search-box">
        <span>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an approved category or faculty name"
        />
      </div>
      <div className="result-head">
        <b>{slots.length} published availability entries</b>
        <span>Source: faculty-approved CLIRDEC schedules</span>
      </div>
      <section className="faculty-grid">
        {!slots.length && (
          <div className="empty-card faculty-availability-empty">
            No future faculty availability is currently published. This list updates automatically when faculty add new times.
          </div>
        )}
        {slots.map((s) => (
          <article className={`faculty-card${s.booking_open === false ? " booking-closed" : ""}`} key={s.id}>
            <div className="faculty-top">
              <span className={`avatar large ${s.color}`}>{s.initials}</span>
              <div>
                <span className={s.booking_open === false ? "booking-status closed" : "available"}>
                  {s.booking_open === false
                    ? "Booking window closed"
                    : "● Faculty-published"}
                </span>
                <h3>{s.faculty_name}</h3>
                <p>{s.expertise}</p>
                {s.subjects.length > 0 && (
                  <div className="faculty-subject-chips" aria-label="Subjects handled">
                    {s.subjects.slice(0, 3).map((subject) => (
                      <span key={subject}>{subject}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="slot-line">
              <span>Published time</span>
              <b>
                {formatManilaDateTime(new Date(s.starts_at), {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                · Philippine time
              </b>
            </div>
            <button
              className="primary wide"
              disabled={s.booking_open === false}
              onClick={() => select(s)}
            >
              {s.booking_open === false
                ? "Less than 24 hours remaining"
                : "Review and request →"}
            </button>
          </article>
        ))}
      </section>
    </>
  );
}
function Schedule({
  booked,
  cancel,
  reschedule,
  busy,
  emailNotifications,
  review,
}: {
  booked: Slot[];
  cancel: (id: string) => void;
  reschedule: (slot: Slot) => void;
  busy: boolean;
  emailNotifications: boolean;
  review: (
    appointmentId: string,
    rating: number,
    comment: string,
  ) => Promise<boolean>;
}) {
  return (
    <>
      <section className="page-head compact">
        <div>
          <p className="eyebrow">CONSULTATION GUIDANCE</p>
          <h1>My requests</h1>
          <p>
            Requests shown here are not appointments until the faculty member
            confirms them.
          </p>
        </div>
      </section>
      <div className="scope-note">
        <b>
          {emailNotifications
            ? "Email notifications enabled"
            : "Email notifications disabled"}
        </b>
        <span>
          {emailNotifications
            ? "Your registered email receives request, decision, cancellation, and reminder updates."
            : "Enable optional email updates from My profile. In-app status remains available here."}{" "}
          Cancelling or rescheduling never removes the audit history.
        </span>
      </div>
      <div className="schedule-list">
        {booked.map((s) => {
          const active = s.status === "pending" || s.status === "confirmed";
          return (
            <article key={s.appointment_id || s.id}>
              <div className="date-block">
                <strong>
                  {formatManilaDateTime(new Date(s.starts_at), {
                    day: "numeric",
                  })}
                </strong>
                <span>
                  {formatManilaDateTime(new Date(s.starts_at), {
                    month: "short",
                  })}
                </span>
              </div>
              <span className={`avatar ${s.color}`}>{s.initials}</span>
              <div className="schedule-info">
                <span className={`status ${s.status || "pending"}`}>
                  {statusLabel(s.status).toUpperCase()}
                </span>
                <h3>{s.topic || s.expertise}</h3>
                <p>
                  {s.faculty_name} ·{" "}
                  {formatManilaDateTime(new Date(s.starts_at), {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
                <small>
                  {emailNotifications
                    ? "✉ Email updates enabled"
                    : "In-app status updates"}{" "}
                  ·{" "}
                  {s.status === "confirmed" || s.status === "completed"
                    ? s.location
                    : s.status === "cancelled" || s.status === "declined"
                      ? "Location no longer applies."
                      : "Final location follows faculty approval."}
                </small>
                {(s.status === "confirmed" || s.status === "completed") && s.appointment_id && (
                  <div className="calendar-actions" aria-label="Calendar options">
                    <button
                      type="button"
                      className="outline"
                      onClick={() =>
                        downloadCalendarFile(
                          appointmentCalendarDetails({
                            id: s.appointment_id!,
                            facultyName: s.faculty_name,
                            topic: s.topic || s.expertise,
                            startsAt: s.starts_at,
                            endsAt: s.ends_at,
                            location: s.location,
                          }),
                        )
                      }
                    >
                      Download calendar (.ics)
                    </button>
                    <a
                      className="outline button-link"
                      href={googleCalendarUrl(
                        appointmentCalendarDetails({
                          id: s.appointment_id,
                          facultyName: s.faculty_name,
                          topic: s.topic || s.expertise,
                          startsAt: s.starts_at,
                          endsAt: s.ends_at,
                          location: s.location,
                        }),
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Add to Google Calendar
                    </a>
                  </div>
                )}
                {s.status === "cancelled" && s.appointment_id && (
                  <div className="calendar-actions" aria-label="Calendar cancellation">
                    <button
                      type="button"
                      className="outline"
                      onClick={() => downloadCalendarFile(appointmentCalendarDetails({
                        id: s.appointment_id!,
                        facultyName: s.faculty_name,
                        topic: s.topic || s.expertise,
                        startsAt: s.starts_at,
                        endsAt: s.ends_at,
                        location: s.location,
                        status: "cancelled",
                      }))}
                    >
                      Download calendar cancellation
                    </button>
                  </div>
                )}
                {active && s.appointment_id && (
                  <div className="inline-actions">
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={() => reschedule(s)}
                    >
                      Choose another time
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy}
                      onClick={() => cancel(s.appointment_id!)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {s.status === "completed" && s.appointment_id && (
                  <ConsultationReviewForm
                    appointmentId={s.appointment_id}
                    existing={s.review}
                    busy={busy}
                    submit={review}
                  />
                )}
              </div>
            </article>
          );
        })}
        {!booked.length && (
          <div className="empty-card">
            You have no consultation requests. Use Consult AI for approved
            guidance, or view faculty availability.
          </div>
        )}
      </div>
    </>
  );
}

function ConsultationReviewForm({
  appointmentId,
  existing,
  busy,
  submit,
}: {
  appointmentId: string;
  existing?: ConsultationReview;
  busy: boolean;
  submit: (
    appointmentId: string,
    rating: number,
    comment: string,
  ) => Promise<boolean>;
}) {
  const [rating, setRating] = useState(existing?.rating || 0);
  const [comment, setComment] = useState(existing?.comment || "");
  const [saved, setSaved] = useState(Boolean(existing));
  useEffect(() => {
    setRating(existing?.rating || 0);
    setComment(existing?.comment || "");
    setSaved(Boolean(existing));
  }, [existing?.id, existing?.rating, existing?.comment]);
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rating) return;
    if (await submit(appointmentId, rating, comment)) setSaved(true);
  };
  return (
    <form className="consultation-review" onSubmit={handleSubmit}>
      <div className="review-heading">
        <div>
          <b>{saved ? "Your consultation review" : "How was your consultation?"}</b>
          <small>Ratings help MISO improve FacultyConnect services.</small>
        </div>
        {saved && <span>Saved</span>}
      </div>
      <fieldset className="star-rating">
        <legend>Consultation rating</legend>
        <div>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              type="button"
              key={star}
              className={star <= rating ? "selected" : ""}
              aria-label={`${star} star${star === 1 ? "" : "s"}`}
              aria-pressed={rating === star}
              onClick={() => {
                setRating(star);
                setSaved(false);
              }}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        Optional comment
        <textarea
          value={comment}
          maxLength={1000}
          placeholder="Share what worked well or what could be improved."
          onChange={(event) => {
            setComment(event.target.value);
            setSaved(false);
          }}
        />
        <small>{comment.length}/1000 characters</small>
      </label>
      <button className="primary" disabled={busy || rating === 0}>
        {busy ? "Saving…" : saved ? "Update review" : "Submit review"}
      </button>
    </form>
  );
}
function StudentProfile({
  user,
  save,
}: {
  user: User;
  save: (values: {
    fullName: string;
    college: string;
    program: string;
    yearLevel: string;
    emailNotifications: boolean;
  }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSaving(true);
    const saved = await save({
      fullName: String(form.get("full_name") || "").trim(),
      college: String(form.get("college") || "").trim(),
      program: String(form.get("program") || "").trim(),
      yearLevel: String(form.get("year_level") || "").trim(),
      emailNotifications: form.get("email_notifications") === "on",
    });
    setSaving(false);
    if (saved) setEditing(false);
  };
  return (
    <>
      <section className="page-head compact student-profile-heading">
        <div>
          <p className="eyebrow">STUDENT ACCOUNT</p>
          <h1>My profile</h1>
          <p>
            Keep your academic details accurate and choose how you receive
            appointment updates.
          </p>
        </div>
      </section>
      <section className="student-profile-layout profile-v2-layout">
        <article className="student-identity-card profile-identity-v2">
          <div className="profile-identity-accent" aria-hidden="true" />
          <div className="profile-identity-main">
            <span className="avatar student-avatar">{initials}</span>
            <div>
              <span className="profile-status-pill">Active student</span>
              <h2>{user.name}</h2>
              <p>{user.email}</p>
            </div>
          </div>
          <div className="profile-identity-meta">
            <span>
              <small>Student number</small>
              <b>{user.student_number || "Not provided"}</b>
            </span>
            <span>
              <small>Account access</small>
              <b>FacultyConnect student</b>
            </span>
          </div>
        </article>
        <article className="student-details-card profile-details-v2">
          <header className="profile-card-header">
            <div>
              <span>Academic information</span>
              <h2>Profile details</h2>
            </div>
            <button
              type="button"
              className="edit-profile-button"
              onClick={() => setEditing(true)}
            >
              Edit profile
            </button>
          </header>
          <div className="profile-information-grid">
            <Info l="College or unit" v={user.college || "Not provided"} />
            <Info l="Degree program" v={user.program || "Not provided"} />
            <Info l="Year level" v={user.year_level || "Not provided"} />
            <Info l="Registered email" v={user.email} />
          </div>
          <div className="profile-preference-card">
            <div className="profile-preference-icon" aria-hidden="true">✉</div>
            <div>
              <span>Appointment email notifications</span>
              <p>
                Receive request receipts, faculty decisions, schedule changes,
                and reminders at your registered email.
              </p>
            </div>
            <b className={user.email_notifications ? "enabled" : "disabled"}>
              {user.email_notifications ? "Enabled" : "Disabled"}
            </b>
          </div>
        </article>
      </section>
      {editing ? (
        <div className="modal-backdrop" onMouseDown={() => setEditing(false)}>
          <form
            className="modal profile-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-edit-title"
            onSubmit={submit}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setEditing(false)}
              aria-label="Close"
            >
              ×
            </button>
            <span className="avatar student-avatar">{initials}</span>
            <h2 id="profile-edit-title">Edit profile</h2>
            <label className="topic">
              Full name
              <input
                name="full_name"
                defaultValue={user.name}
                required
                minLength={3}
                maxLength={120}
              />
            </label>
            <label className="topic">
              Email
              <input value={user.email} disabled />
            </label>
            <div className="profile-edit-grid">
              <label className="topic">
                College or unit
                <input
                  name="college"
                  defaultValue={user.college || ""}
                  placeholder="College of Engineering"
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label className="topic">
                Degree program
                <input
                  name="program"
                  defaultValue={user.program || ""}
                  placeholder="BS Information Technology"
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label className="topic">
                Year level
                <select
                  name="year_level"
                  defaultValue={user.year_level || ""}
                  required
                >
                  <option value="" disabled>Select year level</option>
                  <option>1st year</option>
                  <option>2nd year</option>
                  <option>3rd year</option>
                  <option>4th year</option>
                  <option>5th year or higher</option>
                  <option>Graduate student</option>
                </select>
              </label>
              <label className="topic">
                Student number
                <input value={user.student_number || "Not provided"} disabled />
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                name="email_notifications"
                defaultChecked={user.email_notifications}
              />
              <span>Send availability, request, status, cancellation, and reminder emails</span>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
function Chat({
  chat,
  question,
  setQuestion,
  ask,
}: {
  chat: ChatMessage[];
  question: string;
  setQuestion: (s: string) => void;
  ask: (e: FormEvent, captchaToken?: string) => Promise<ChatAskResult>;
}) {
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaGeneration, setCaptchaGeneration] = useState(0);
  const [chatTrusted, setChatTrusted] = useState(false);
  const [trustExpiresAt, setTrustExpiresAt] = useState(0);
  const [trustLoading, setTrustLoading] = useState(Boolean(TURNSTILE_SITE_KEY));
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const messages = messagesRef.current;
    if (!messages) return;
    messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
  }, [chat]);

  useEffect(() => {
    let active = true;
    void getChatTrustStatus().then((status) => {
      if (!active) return;
      setChatTrusted(status.trusted);
      setTrustExpiresAt(
        status.trusted ? Date.now() + status.expiresInSeconds * 1000 : 0,
      );
      setTrustLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!chatTrusted || !trustExpiresAt) return;
    const remaining = trustExpiresAt - Date.now();
    if (remaining <= 0) {
      setChatTrusted(false);
      setTrustExpiresAt(0);
      setCaptchaGeneration((value) => value + 1);
      return;
    }
    const timer = window.setTimeout(() => {
      setChatTrusted(false);
      setTrustExpiresAt(0);
      setCaptchaGeneration((value) => value + 1);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [chatTrusted, trustExpiresAt]);

  const submit = async (event: FormEvent) => {
    if (!PRODUCTION_SECURITY_READY) {
      event.preventDefault();
      return;
    }
    if (trustLoading || (TURNSTILE_SITE_KEY && !chatTrusted && !captchaToken)) {
      event.preventDefault();
      return;
    }
    const result = await ask(event, captchaToken || undefined);
    if (result === "ok" && captchaToken) {
      const status = await getChatTrustStatus();
      setChatTrusted(status.trusted);
      setTrustExpiresAt(
        status.trusted ? Date.now() + status.expiresInSeconds * 1000 : 0,
      );
    } else if (result === "challenge") {
      setChatTrusted(false);
      setTrustExpiresAt(0);
    }
    if (captchaToken || result === "challenge") {
      setCaptchaToken("");
      setCaptchaGeneration((value) => value + 1);
    }
  };
  return (
    <>
      <section className="page-head compact">
        <div>
          <p className="eyebrow">VERIFIED CONSULTATION GUIDANCE</p>
          <h1>Consult AI</h1>
          <p>
            Answers use Product Owner or CLIRDEC-approved information.
            Unsupported and sensitive questions receive a safe referral.
          </p>
        </div>
      </section>
      <div className="assistant-safety">
        <span>✓ Approved FAQ knowledge</span>
        <span>✓ English, Filipino, or mixed phrasing</span>
        <span>✓ Safe fallback and staff referral</span>
      </div>
      <section className="chatbot">
        {!PRODUCTION_SECURITY_READY && (
          <div className="form-notice error" role="alert">
            <b>Security verification unavailable</b>
            <span>The chatbot is paused until MISO restores the security check.</span>
          </div>
        )}
        <div className="chat-head">
          <span className="ai-mark">✦</span>
          <div>
            <b>Consult AI</b>
            <small>Online · Approved CLIRDEC knowledge base</small>
          </div>
        </div>
        <div
          className="messages"
          ref={messagesRef}
          role="log"
          aria-label="Consult AI conversation"
          aria-live="polite"
          tabIndex={0}
        >
          {chat.map((m, i) => (
            <div key={i} className={`message-wrap ${m.who}`}>
              <p>{m.text}</p>
              {m.who === "bot" && m.source && <small>Source: {m.source}</small>}
              {m.escalation && (
                <small className="escalation-note">
                  Staff follow-up recommended
                </small>
              )}
              {m.who === "bot" && Boolean(m.suggestions?.length) && (
                <div className="chat-suggestions" aria-label="Suggested follow-up questions">
                  {m.suggestions?.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => setQuestion(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="prompts">
          <button
            onClick={() =>
              setQuestion("What faculty consultation services are available?")
            }
          >
            Portal services
          </button>
          <button
            onClick={() =>
              setQuestion("How do I request a faculty consultation?")
            }
          >
            Request consultation
          </button>
          <button
            onClick={() =>
              setQuestion("How do I find the appropriate faculty member?")
            }
          >
            Find faculty
          </button>
          <button onClick={() => setQuestion("Can I use the portal on my phone?")}>
            Mobile access
          </button>
        </div>
        <form onSubmit={submit}>
          <input
            aria-label="Chat question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask in English, Filipino, or mixed language..."
            minLength={2}
            maxLength={500}
            required
            disabled={!PRODUCTION_SECURITY_READY}
          />
          {TURNSTILE_SITE_KEY && !trustLoading && !chatTrusted && (
            <div className={`turnstile-field chat-turnstile${captchaToken ? " is-complete" : ""}`}>
              <div className="turnstile-widget-shell" aria-hidden={Boolean(captchaToken)}>
                <Turnstile
                  key={captchaGeneration}
                  siteKey={TURNSTILE_SITE_KEY}
                  options={{ theme: "light", size: "flexible", action: "chatbot_question" }}
                  onSuccess={setCaptchaToken}
                  onExpire={() => setCaptchaToken("")}
                  onError={() => setCaptchaToken("")}
                />
              </div>
              {captchaToken && (
                <p className="turnstile-confirmed" role="status">
                  <span aria-hidden="true">✓</span>
                  Security check complete
                </p>
              )}
            </div>
          )}
          {chatTrusted && (
            <p className="chat-trust-active" role="status">
              <span aria-hidden="true">✓</span>
              Protected chat session active
            </p>
          )}
          <button
            className="primary"
            disabled={!PRODUCTION_SECURITY_READY || trustLoading}
          >
            Send →
          </button>
        </form>
        <footer className="chat-source">
          Answers must be traceable to an approved FAQ, office advisory, service
          directory, or faculty-maintained schedule.
        </footer>
      </section>
    </>
  );
}
function BookingModal({
  slot,
  topic,
  setTopic,
  close,
  confirm,
  submitting,
  rescheduling,
}: {
  slot: Slot;
  topic: string;
  setTopic: (value: string) => void;
  close: () => void;
  confirm: () => void;
  submitting: boolean;
  rescheduling: boolean;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={close} aria-label="Close">
          ×
        </button>
        <p className="eyebrow">
          {rescheduling ? "RESCHEDULE CONSULTATION" : "CONSULTATION REQUEST"}
        </p>
        <h2 id="booking-title">
          {rescheduling
            ? "Move to this published time"
            : "Request a published time"}
        </h2>
        <div className="modal-faculty">
          <span className={`avatar large ${slot.color}`}>{slot.initials}</span>
          <div>
            <h3>{slot.faculty_name}</h3>
            <p>{slot.expertise}</p>
          </div>
        </div>
        <div className="booking-details">
          <div>
            <span>Preferred date</span>
            <b>
              {new Date(slot.starts_at).toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </b>
          </div>
          <div>
            <span>Preferred time</span>
            <b>
              {new Date(slot.starts_at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </b>
          </div>
          <div>
            <span>Availability source</span>
            <b>Faculty-maintained schedule</b>
          </div>
        </div>
        <label className="topic">
          Consultation topic and concern
          <textarea
            required
            value={topic}
            maxLength={240}
            disabled={rescheduling}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Provide enough context for the faculty member to review your request"
          />
        </label>
        <button
          className="primary wide"
          disabled={submitting}
          onClick={confirm}
        >
          {submitting
            ? "Saving…"
            : rescheduling
              ? "Confirm new time →"
              : "Submit request →"}
        </button>
        <small className="modal-note">
          {rescheduling
            ? "The previous request is cancelled only after the new time is reserved successfully."
            : "Submitting does not confirm an appointment. The faculty member must review and approve the request."}
        </small>
      </section>
    </div>
  );
}
type FView = "fhome" | "requests" | "availability" | "fprofile";
type AView =
  | "ahome"
  | "users"
  | "activity"
  | "appointments"
  | "reviews"
  | "knowledge"
  | "operations";
function RoleWorkspace({ user, logout }: { user: User; logout: () => void }) {
  const faculty = user.role === "faculty";
  const [view, setView] = useState<FView | AView>(faculty ? "fhome" : "ahome");
  const [menu, setMenu] = useState(false);
  const portalMetadata: Record<FView | AView, [string, string]> = {
    fhome: ["Faculty overview | CLSU FacultyConnect", "Review consultation activity and published faculty availability."],
    requests: ["Consultation requests | CLSU FacultyConnect", "Review, approve, decline, and complete student consultation requests."],
    availability: ["Manage availability | CLSU FacultyConnect", "Publish and manage weekday faculty consultation schedules."],
    fprofile: ["Faculty profile | CLSU FacultyConnect", "Manage faculty expertise and consultation profile information."],
    ahome: ["Administration overview | CLSU FacultyConnect", "Monitor FacultyConnect users, consultations, and service performance."],
    users: ["Users and roles | CLSU FacultyConnect", "Administer audited FacultyConnect roles and review student self-registration rules."],
    activity: ["Active users | CLSU FacultyConnect", "Monitor recent authenticated portal activity across student, faculty, and administrator roles."],
    appointments: ["Consultation logs | CLSU FacultyConnect", "Review consultation status, participants, schedules, and service exceptions."],
    reviews: ["Reviews and insights | CLSU FacultyConnect", "Analyze consultation ratings and comments by year level, college, and course."],
    knowledge: ["Chatbot training | CLSU FacultyConnect", "Train and test the consultation assistant with approved answers, example phrases, and official sources."],
    operations: ["Operations and health | CLSU FacultyConnect", "Monitor email delivery, audit records, application errors, retention, and release evidence."],
  };
  usePageMetadata(portalMetadata[view][0], portalMetadata[view][1]);
  const nav: [FView | AView, string, NavIconName][] = faculty
    ? [
        ["fhome", "Overview", "home"],
        ["requests", "Requests", "requests"],
        ["availability", "Availability", "calendar"],
        ["fprofile", "Profile", "profile"],
      ]
    : [
        ["ahome", "Service overview", "home"],
        ["knowledge", "Chatbot training", "assistant"],
        ["users", "Users and roles", "users"],
        ["activity", "Active users", "users"],
        ["appointments", "Consultation logs", "calendar"],
        ["reviews", "Reviews and insights", "report"],
        ["operations", "Operations and health", "report"],
      ];
  const navigate = (target: FView | AView) => {
    setView(target);
    setMenu(false);
  };
  return (
    <div className={`app role-app ${faculty ? "faculty-app" : "admin-app"}`}>
      <SkipLink />
      <header className="topbar">
        <button
          type="button"
          className="brand-button"
          onClick={() => navigate(faculty ? "fhome" : "ahome")}
        >
          <BrandLogo />
          <span>
            <b>CLSU FacultyConnect</b>
            <small>Faculty consultation administration</small>
          </span>
        </button>
        <div className="top-actions">
          <NotificationCenter
            user={user}
            onNavigate={(target) => navigate(target as FView | AView)}
          />
          <button
            type="button"
            className="profile-chip"
            onClick={() => navigate(faculty ? "fprofile" : "users")}
            aria-label={faculty ? "Open my profile" : "Open users and roles"}
          >
            <span>
              {user.name
                .split(" ")
                .map((x) => x[0])
                .join("")
                .slice(0, 2)}
            </span>
            <i>
              <b>{user.name}</b>
              <small>{faculty ? "Faculty" : "Authorized administrator"}</small>
            </i>
          </button>
          <button
            type="button"
            className="menu-button"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle menu"
            aria-expanded={menu}
          >
            ☰
          </button>
        </div>
      </header>
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div>
          <p className="side-kicker">
            {faculty ? "FACULTY PORTAL" : "AUTHORIZED CONTENT ADMIN"}
          </p>
          <nav>
            {nav.map(([v, l, i]) => (
              <Nav
                key={v}
                active={view === v}
                label={l}
                icon={i}
                onClick={() => navigate(v)}
              />
            ))}
          </nav>
        </div>
        <div className="side-foot">
          <span>Central Luzon State University</span>
          <small>Role-restricted administrative service</small>
          <PortalFooterActions onLogout={logout} />
        </div>
      </aside>
      <main
        id="main-content"
        className={`content ${faculty ? "faculty-content" : "admin-content"} view-${view}`}
      >
        {faculty ? (
          <FacultyPages view={view as FView} user={user} />
        ) : (
          <AdminPages view={view as AView} user={user} />
        )}
      </main>
      <MobilePortalNav
        active={view}
        navigate={(target) => navigate(target as FView | AView)}
        items={
          faculty
            ? [
                ["fhome", "Overview", "home"],
                ["requests", "Requests", "requests"],
                ["availability", "Schedule", "calendar"],
                ["fprofile", "Profile", "profile"],
              ]
            : [
                ["ahome", "Overview", "home"],
                ["knowledge", "Train AI", "assistant"],
                ["users", "Users", "users"],
                ["activity", "Active", "users"],
                ["appointments", "Logs", "calendar"],
                ["reviews", "Reviews", "report"],
                ["operations", "Health", "report"],
              ]
        }
      />
    </div>
  );
}
function Head({
  label,
  title,
  copy,
}: {
  label: string;
  title: string;
  copy: string;
}) {
  return (
    <section className="page-head portal-head">
      <div>
        <p className="eyebrow">{label}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
    </section>
  );
}
function Stats({ data }: { data: string[][] }) {
  return (
    <div className="metrics">
      {data.map((x) => (
        <article key={x[1]}>
          <b>{x[0]}</b>
          <span>{x[1]}</span>
        </article>
      ))}
    </div>
  );
}
function WeekdayAvailabilityCalendar({
  weekStart,
  setWeekStart,
  selectedStart,
  setSelectedStart,
  duration,
  slots,
}: {
  weekStart: string;
  setWeekStart: (dateKey: string) => void;
  selectedStart: Date | null;
  setSelectedStart: (date: Date) => void;
  duration: number;
  slots: FacultyAvailability[];
}) {
  const days = weekDays(weekStart);
  const times = calendarTimes();
  const firstWeek = initialCalendarWeek();
  const now = new Date();
  const selectedTime = selectedStart?.getTime();
  const selectedEndTime = selectedStart
    ? selectedStart.getTime() + duration * 60_000
    : null;
  const range = `${formatCalendarDay(days[0], { month: "short", day: "numeric" })} – ${formatCalendarDay(days[4], { month: "short", day: "numeric", year: "numeric" })}`;
  return (
    <div className="weekly-calendar">
      <div className="calendar-toolbar">
        <div>
          <p className="eyebrow">MONDAY–FRIDAY</p>
          <h3>{range}</h3>
        </div>
        <div className="week-controls">
          <button
            type="button"
            className="outline"
            disabled={weekStart <= firstWeek}
            onClick={() => setWeekStart(addCalendarDays(weekStart, -7))}
            aria-label="Previous week"
          >
            ←
          </button>
          <button
            type="button"
            className="outline"
            onClick={() => setWeekStart(addCalendarDays(weekStart, 7))}
            aria-label="Next week"
          >
            →
          </button>
        </div>
      </div>
      <div
        className="calendar-scroll"
        tabIndex={0}
        aria-label="Weekday availability calendar"
      >
        <div className="availability-grid">
          <span className="calendar-corner">Time</span>
          {days.map((day) => (
            <span className="calendar-day" key={day}>
              <b>{formatCalendarDay(day, { weekday: "short" })}</b>
              <small>
                {formatCalendarDay(day, { month: "short", day: "numeric" })}
              </small>
            </span>
          ))}
          {times.map((minutes) => (
            <div className="calendar-row" key={minutes}>
              <b className="calendar-time">{formatTime(minutes)}</b>
              {days.map((day) => {
                const start = manilaInstant(day, minutes);
                const end = new Date(start.getTime() + duration * 60_000);
                const cellEnd = new Date(start.getTime() + 30 * 60_000);
                const publishedSlot = slots.find((slot) => {
                  const publishedStart = new Date(slot.starts_at);
                  const publishedEnd = new Date(slot.ends_at);
                  return start < publishedEnd && cellEnd > publishedStart;
                });
                const conflict = Boolean(publishedSlot);
                const reason = availabilityValidationMessage(
                  start,
                  end,
                  slots,
                  now,
                );
                const selected = selectedTime === start.getTime();
                const selectedRange = Boolean(
                  selectedTime !== undefined &&
                    selectedEndTime !== null &&
                    start.getTime() < selectedEndTime &&
                    cellEnd.getTime() > selectedTime,
                );
                const publishedStartsHere = Boolean(
                  publishedSlot &&
                    new Date(publishedSlot.starts_at).getTime() === start.getTime(),
                );
                const publishedDuration = publishedSlot
                  ? Math.round(
                      (new Date(publishedSlot.ends_at).getTime() -
                        new Date(publishedSlot.starts_at).getTime()) /
                        60_000,
                    )
                  : 0;
                const state = conflict
                  ? "Published"
                  : reason
                    ? "Unavailable"
                    : selectedRange
                      ? "Selected"
                      : "Available";
                return (
                  <button
                    type="button"
                    key={day}
                    className={`slot-toggle${selectedRange ? " selected-range" : ""}${selected ? " selected selected-start" : ""}${conflict ? " occupied" : ""}${publishedStartsHere ? " occupied-start" : ""}`}
                    disabled={Boolean(reason)}
                    onClick={() => setSelectedStart(start)}
                    title={reason || `Select ${formatTime(minutes)}`}
                    aria-label={`${formatCalendarDay(day, { weekday: "long", month: "long", day: "numeric" })} at ${formatTime(minutes)} — ${state}`}
                  >
                    <span>
                      {publishedStartsHere
                        ? `${publishedDuration} min`
                        : selected
                          ? `${duration} min`
                          : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="calendar-legend">
        <span>
          <i className="legend-open" />
          Available
        </span>
        <span>
          <i className="legend-selected" />
          Selected
        </span>
        <span>
          <i className="legend-busy" />
          Already published
        </span>
      </div>
      <p className="availability-foot">
        Times use Philippine Standard Time. The calendar disables weekends, past
        times, entries with less than 24 hours’ notice, and overlaps.
      </p>
    </div>
  );
}

function FacultyDiscoveryFields({ profile }: { profile: FacultyProfile }) {
  return (
    <>
      <label>
        Expertise categories
        <input name="expertise" defaultValue={profile.expertise.join(", ")} placeholder="Software Engineering, Data Analytics" required maxLength={1200} />
        <small>Broad, verified areas of professional or academic expertise.</small>
      </label>
      <label>
        Subjects or courses handled
        <input name="subjects" defaultValue={profile.subjects.join(", ")} placeholder="Web Systems, Database Management, Capstone Project" required maxLength={2000} />
        <small>Use the course names students are likely to search for.</small>
      </label>
      <label>
        Accepted consultation topics
        <input name="consultation_topics" defaultValue={profile.consultation_topics.join(", ")} placeholder="Thesis methods, system architecture, research proposal" required maxLength={2000} />
        <small>Describe the specific concerns you are prepared to discuss.</small>
      </label>
      <label>
        Research interests <span className="optional-label">Optional</span>
        <input name="research_interests" defaultValue={profile.research_interests.join(", ")} placeholder="Natural language processing, educational technology" maxLength={1200} />
      </label>
      <label>
        Office or consultation location <span className="optional-label">Optional</span>
        <input name="office_location" defaultValue={profile.office_location} placeholder="MISO Building, Room 201" maxLength={200} />
        <small>Do not include a private home address or personal contact details.</small>
      </label>
      <label>
        Faculty introduction <span className="optional-label">Optional</span>
        <textarea name="bio" defaultValue={profile.bio} placeholder="Briefly describe your background and the consultation concerns you can support." rows={5} maxLength={2000} />
        <small>Students see this before requesting a consultation.</small>
      </label>
    </>
  );
}

function FacultyPages({ view, user }: { view: FView; user: User }) {
  const [requests, setRequests] = useState<FacultyRequest[]>([]);
  const [facultySlots, setFacultySlots] = useState<FacultyAvailability[]>([]);
  const [profile, setProfile] = useState<FacultyProfile>({
    expertise: [],
    subjects: [],
    consultation_topics: [],
    research_interests: [],
    bio: "",
    office_location: "",
    profile_completed: false,
    active: true,
  });
  const [onboardingDismissed, setOnboardingDismissed] = useState(() =>
    window.sessionStorage.getItem(`facultyconnect:profile-skip:${user.id}`) === "1",
  );
  const [loading, setLoading] = useState(configured);
  const [message, setMessage] = useState("");
  const [requestFilter, setRequestFilter] = useState<
    "pending" | "confirmed" | "completed"
  >("pending");
  const [calendarWeek, setCalendarWeek] = useState(() => initialCalendarWeek());
  const [selectedStart, setSelectedStart] = useState<Date | null>(null);
  const [duration, setDuration] = useState(30);
  const [consultationMode, setConsultationMode] = useState<
    "in_person" | "online"
  >("in_person");
  const [publishing, setPublishing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const refresh = async (showLoading = false) => {
    if (!configured) return;
    if (showLoading) setLoading(true);
    try {
      const [data, facultyProfile] = await Promise.all([
        loadFacultyPortal(user.id),
        loadFacultyProfile(user.id),
      ]);
      setRequests(data.requests);
      setFacultySlots(data.availability);
      setProfile(facultyProfile);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Faculty data could not be loaded.",
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  };
  useEffect(() => {
    const backgroundRefresh = () => void refresh(false);
    void refresh(true);
    const interval = window.setInterval(backgroundRefresh, 30_000);
    window.addEventListener("focus", backgroundRefresh);
    const appointmentChannel = supabase
      .channel(`faculty-appointments:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments" },
        backgroundRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability",
          filter: `faculty_id=eq.${user.id}`,
        },
        backgroundRefresh,
      )
      .subscribe();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", backgroundRefresh);
      void supabase.removeChannel(appointmentChannel);
    };
  }, [user.id]);
  const pending = requests.filter((item) => item.status === "pending");
  const confirmed = requests.filter((item) => item.status === "confirmed");
  const now = new Date();
  const upcomingConfirmed = confirmed.filter((item) =>
    isUpcomingSlot(item, now),
  );
  const upcomingSlots = facultySlots.filter((slot) =>
    isUpcomingSlot(slot, now),
  );
  const decide = async (id: string, status: "confirmed" | "declined") => {
    setMessage("");
    try {
      await decideFacultyRequest(id, status);
      setMessage(
        status === "confirmed"
          ? "Request approved. The student email notification was queued."
          : "Request declined. The student email notification was queued.",
      );
      await refresh();
      window.dispatchEvent(new Event("facultyconnect:refresh-notifications"));
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The request could not be updated.",
      );
    }
  };
  const complete = async (id: string) => {
    setMessage("");
    try {
      await completeFacultyRequest(id);
      setMessage("Consultation marked completed.");
      await refresh();
      window.dispatchEvent(new Event("facultyconnect:refresh-notifications"));
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The consultation could not be completed.",
      );
    }
  };
  const publish = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    if (!selectedStart) {
      setMessage("Select an available weekday and time from the calendar.");
      return;
    }
    const end = new Date(selectedStart.getTime() + duration * 60_000);
    const validation = availabilityValidationMessage(
      selectedStart,
      end,
      facultySlots,
    );
    if (validation) {
      setMessage(validation);
      return;
    }
    setMessage("");
    setPublishing(true);
    try {
      const published = await createFacultyAvailability({
        facultyId: user.id,
        startsAt: selectedStart.toISOString(),
        endsAt: end.toISOString(),
        location: String(form.get("location") || "").trim(),
        consultationMode,
      });
      setFacultySlots((current) =>
        [...current.filter((slot) => slot.id !== published.id), published].sort(
          (left, right) =>
            new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime(),
        ),
      );
      formElement.reset();
      setSelectedStart(null);
      setDuration(30);
      setConsultationMode("in_person");
      setMessage("Availability published for students.");
      await refresh();
      window.dispatchEvent(new Event("facultyconnect:refresh-notifications"));
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Availability could not be published.",
      );
    } finally {
      setPublishing(false);
    }
  };
  const removeSlot = async (id: string) => {
    try {
      await removeFacultyAvailability(id);
      setFacultySlots((current) =>
        current.map((slot) =>
          slot.id === id ? { ...slot, is_open: false } : slot,
        ),
      );
      setMessage("Open availability removed.");
      await refresh();
      window.dispatchEvent(new Event("facultyconnect:refresh-notifications"));
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Availability could not be removed.",
      );
    }
  };
  const saveProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setMessage("");
    setSavingProfile(true);
    try {
      await updateFacultyProfile({
        userId: user.id,
        expertise: String(form.get("expertise") || "").split(","),
        subjects: String(form.get("subjects") || "").split(","),
        consultationTopics: String(form.get("consultation_topics") || "").split(","),
        researchInterests: String(form.get("research_interests") || "").split(","),
        bio: String(form.get("bio") || ""),
        officeLocation: String(form.get("office_location") || ""),
      });
      setMessage("Faculty profile updated for student search.");
      setOnboardingDismissed(true);
      await refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The faculty profile could not be updated.",
      );
    } finally {
      setSavingProfile(false);
    }
  };
  if (loading)
    return (
      <PortalLoader
        compact
        label="Loading faculty workspace"
        detail="Syncing requests, appointments, and published availability."
      />
    );
  const onboarding = !profile.profile_completed && !onboardingDismissed ? (
    <div className="profile-onboarding-backdrop">
      <section className="profile-onboarding" role="dialog" aria-modal="true" aria-labelledby="faculty-onboarding-title">
        <div className="profile-onboarding-intro">
          <p className="eyebrow">COMPLETE YOUR FACULTY DIRECTORY PROFILE</p>
          <h2 id="faculty-onboarding-title">Help students find the right professor.</h2>
          <p>Consult AI and Faculty availability use only the verified subjects, expertise, and consultation topics faculty members provide here.</p>
          <div className="onboarding-benefits">
            <span>1 <b>Better subject matching</b></span>
            <span>2 <b>Accurate chatbot recommendations</b></span>
            <span>3 <b>Clearer consultation requests</b></span>
          </div>
        </div>
        <form className="knowledge-form profile-onboarding-form" onSubmit={saveProfile}>
          <FacultyDiscoveryFields profile={profile} />
          <div className="profile-onboarding-actions">
            <button className="primary" disabled={savingProfile}>{savingProfile ? "Saving profile…" : "Save and continue"}</button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                window.sessionStorage.setItem(`facultyconnect:profile-skip:${user.id}`, "1");
                setOnboardingDismissed(true);
              }}
            >
              Skip for now
            </button>
          </div>
          <small>You can complete or update these details later from Profile.</small>
        </form>
      </section>
    </div>
  ) : null;
  const feedback = (
    <>
      {onboarding}
      {message && (
        <div className="notice" role="status" aria-live="polite">
          <b>✓</b>
          <span>{message}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setMessage("")}>×</button>
        </div>
      )}
    </>
  );
  if (view === "fhome")
    return (
      <>
        {feedback}
        <Head
          label="FACULTY PORTAL"
          title={`Welcome, ${user.name}`}
          copy="Manage your consultation requests and published availability from one place."
        />
        <Stats
          data={[
            [String(upcomingConfirmed.length), "Upcoming consultations"],
            [String(pending.length), "Pending requests"],
            [
              String(upcomingSlots.filter((slot) => slot.is_open).length),
              "Open time slots",
            ],
            [
              String(
                requests.filter((item) => item.status === "completed").length,
              ),
              "Completed sessions",
            ],
          ]}
        />
        <div className="workspace-grid">
          <Work title="Upcoming consultations">
            {upcomingConfirmed.slice(0, 4).map((r) => (
              <Line
                key={r.id}
                a={formatManilaDateTime(new Date(r.starts_at), {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                b={r.topic}
                c={r.student_name}
              />
            ))}
            {!upcomingConfirmed.length && (
              <div className="empty-card">
                No upcoming confirmed consultations.
              </div>
            )}
          </Work>
          <Work title="Published availability">
            {upcomingSlots.slice(0, 5).map((slot) => (
              <Line
                key={slot.id}
                a={formatManilaDateTime(new Date(slot.starts_at), {
                  weekday: "short",
                })}
                b={formatManilaDateTime(new Date(slot.starts_at), {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                c={slot.is_open ? "Open for requests" : "Already requested"}
              />
            ))}
            {!upcomingSlots.length && (
              <div className="empty-card">
                No upcoming availability is published.
              </div>
            )}
          </Work>
        </div>
      </>
    );
  if (view === "requests")
    return (
      <>
        {feedback}
        <FacultyRequestWorkspace
          requests={requests}
          facultyName={user.name}
          filter={requestFilter}
          setFilter={setRequestFilter}
          decide={decide}
          complete={complete}
        />
      </>
    );
  if (view === "availability") {
    const selectedEnd = selectedStart
      ? new Date(selectedStart.getTime() + duration * 60_000)
      : null;
    const selectionError =
      selectedStart && selectedEnd
        ? availabilityValidationMessage(
            selectedStart,
            selectedEnd,
            facultySlots,
          )
        : "";
    const openUpcoming = upcomingSlots.filter((slot) => slot.is_open);
    const reservedUpcoming = upcomingSlots.filter((slot) => !slot.is_open);
    const nextBookable = firstBookableStart();
    return (
      <>
        {feedback}
        <Head
          label="FACULTY PORTAL"
          title="Manage availability"
          copy="Publish clear consultation hours for students. Times use Philippine Standard Time and close automatically when requested."
        />
        <section className="availability-summary-band" aria-label="Schedule summary">
          <div>
            <span>Open for students</span>
            <b>{openUpcoming.length}</b>
            <small>Upcoming time slots</small>
          </div>
          <div>
            <span>Reserved</span>
            <b>{reservedUpcoming.length}</b>
            <small>Awaiting or holding requests</small>
          </div>
          <div>
            <span>Earliest publishable time</span>
            <b className="availability-summary-date">
              {formatManilaDateTime(nextBookable, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </b>
            <small>
              {formatManilaDateTime(nextBookable, {
                hour: "numeric",
                minute: "2-digit",
              })} · 24-hour notice
            </small>
          </div>
        </section>
        <div className="availability-layout availability-layout-v2">
          <Work title="Choose a weekday and time">
            <div className="availability-instruction">
              <span>1</span>
              <p>
                Select one available cell. Gray times are outside the allowed
                window or already published.
              </p>
            </div>
            <WeekdayAvailabilityCalendar
              weekStart={calendarWeek}
              setWeekStart={setCalendarWeek}
              selectedStart={selectedStart}
              setSelectedStart={setSelectedStart}
              duration={duration}
              slots={facultySlots}
            />
          </Work>
          <div className="availability-side">
            <Work title="Publish selected time">
              <form className="knowledge-form publish-availability-form" onSubmit={publish}>
                <div
                  className={`selected-slot-summary${selectionError ? " invalid" : ""}`}
                >
                  <span>2 · Confirm the selected consultation</span>
                  {selectedStart && selectedEnd ? (
                    <>
                      <b>
                        {formatManilaDateTime(selectedStart, {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}
                      </b>
                      <p>
                        {formatManilaDateTime(selectedStart, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        –
                        {formatManilaDateTime(selectedEnd, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        · Philippine time
                      </p>
                    </>
                  ) : (
                    <p>No time selected yet. Choose a white calendar cell.</p>
                  )}
                  {selectionError && <small>{selectionError}</small>}
                </div>
                <label>
                  <span>3 · Duration</span>
                  <select
                    name="duration"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  >
                    <option value="15">15 minutes</option>
                    <option value="20">20 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
                    <option value="90">90 minutes</option>
                    <option value="120">2 hours</option>
                  </select>
                </label>
                <label>
                  <span>4 · Consultation mode</span>
                  <select
                    name="consultation_mode"
                    value={consultationMode}
                    onChange={(event) =>
                      setConsultationMode(
                        event.target.value as "in_person" | "online",
                      )
                    }
                  >
                    <option value="in_person">In person</option>
                    <option value="online">Online</option>
                  </select>
                </label>
                {consultationMode === "online" && (
                  <div className="online-meeting-warning" role="note">
                    <span aria-hidden="true">!</span>
                    <p>
                      <b>Create the meeting link before publishing.</b>
                      FacultyConnect does not generate or host online meeting
                      links. Use your approved platform, then paste its complete
                      link or joining instructions below.
                    </p>
                  </div>
                )}
                <label>
                  <span>
                    5 · {consultationMode === "online"
                      ? "Meeting link or joining instructions"
                      : "Consultation location"}
                  </span>
                  <input
                    name="location"
                    required
                    placeholder={
                      consultationMode === "online"
                        ? "Paste the approved meeting link or platform details"
                        : "CLIRDEC room or faculty office"
                    }
                  />
                </label>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    publishing || !selectedStart || Boolean(selectionError)
                  }
                >
                  {publishing ? "Publishing…" : "Publish availability"}
                </button>
                <small className="publish-help-text">
                  Students will see this time immediately after it is published.
                </small>
              </form>
            </Work>
          </div>
        </div>
        <Work title="Published schedule">
          <div className="published-schedule-header">
            <p>
              Review every upcoming time in one place. Open slots may be removed;
              reserved slots remain locked to protect the student request.
            </p>
            <span>{upcomingSlots.length} upcoming</span>
          </div>
          <div className="published-slots published-slots-grid">
            {upcomingSlots.map((slot) => (
              <article className="published-slot" key={slot.id}>
                <div className="published-slot-date" aria-hidden="true">
                  <span>
                    {formatManilaDateTime(new Date(slot.starts_at), {
                      month: "short",
                    })}
                  </span>
                  <b>
                    {formatManilaDateTime(new Date(slot.starts_at), {
                      day: "numeric",
                    })}
                  </b>
                </div>
                <div className="published-slot-copy">
                  <div className="published-slot-head">
                    <span
                      className={
                        slot.is_open
                          ? "slot-state open"
                          : "slot-state requested"
                      }
                    >
                      {slot.is_open ? "Open" : "Reserved"}
                    </span>
                    <b>
                      {formatManilaDateTime(new Date(slot.starts_at), {
                        weekday: "long",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </b>
                  </div>
                  <small>
                    {slot.consultation_mode === "online" ? "Online" : "In person"}
                    {" · "}
                    {slot.location || "Location provided after approval"}
                  </small>
                </div>
                {slot.is_open ? (
                  <button
                    type="button"
                    className="published-slot-remove"
                    onClick={() => void removeSlot(slot.id)}
                  >
                    Remove
                  </button>
                ) : (
                  <span
                    className="published-slot-lock"
                    aria-label="This time has a consultation request"
                  >
                    Locked
                  </span>
                )}
              </article>
            ))}
            {!upcomingSlots.length && (
              <div className="empty-card">
                No upcoming availability has been published.
              </div>
            )}
          </div>
        </Work>
      </>
    );
  }
  return (
    <>
      {feedback}
      <Head
        label="FACULTY PORTAL"
        title="Faculty profile"
        copy="Present your verified expertise clearly so students can choose the right consultation path."
      />
      <section className="profile-layout faculty-profile-v2">
        <article className="profile-summary faculty-profile-identity">
          <div className="faculty-profile-pattern" aria-hidden="true" />
          <span className="avatar profile-avatar coral">
            {user.name
              .split(" ")
              .map((x) => x[0])
              .join("")
              .slice(0, 2)}
          </span>
          <span className="faculty-verified-badge">Verified faculty</span>
          <h2>{user.name}</h2>
          <p>{user.department || "CLSU faculty member"}</p>
          <small>{user.email}</small>
          <div className="faculty-profile-state">
            <i className={profile.active ? "active" : "inactive"} />
            {profile.active
              ? "Visible in student search"
              : "Hidden from student search"}
          </div>
        </article>
        <article className="profile-details editable-profile faculty-profile-editor">
          <header className="profile-card-header">
            <div>
              <span>Public consultation profile</span>
              <h2>Expertise and introduction</h2>
            </div>
          </header>
          <form className="knowledge-form faculty-discovery-form" onSubmit={saveProfile}>
            <FacultyDiscoveryFields profile={profile} />
            <div className="profile-expertise-preview" aria-label="Current expertise">
              {profile.expertise.map((item) => (
                <span key={item}>{item}</span>
              ))}
              {!profile.expertise.length && <small>No expertise added yet.</small>}
            </div>
            <button className="primary" disabled={savingProfile}>
              {savingProfile ? "Saving profile…" : "Save faculty profile"}
            </button>
          </form>
          <aside className="faculty-profile-guidance">
            <h3>Profile guidance</h3>
            <p>
              <b>Availability</b>
              Only weekday times you publish are shown to students.
            </p>
            <p>
              <b>Privacy</b>
              Consultation concerns remain limited to participants and authorized
              administrators.
            </p>
            <p>
              <b>Accuracy</b>
              Keep expertise labels concise and use the terminology approved by
              your unit.
            </p>
          </aside>
        </article>
      </section>
    </>
  );
}
function FacultyRequestWorkspace({
  requests,
  facultyName,
  filter,
  setFilter,
  decide,
  complete,
}: {
  requests: FacultyRequest[];
  facultyName: string;
  filter: "pending" | "confirmed" | "completed";
  setFilter: (value: "pending" | "confirmed" | "completed") => void;
  decide: (id: string, status: "confirmed" | "declined") => Promise<void>;
  complete: (id: string) => Promise<void>;
}) {
  const counts = {
    pending: requests.filter((item) => item.status === "pending").length,
    confirmed: requests.filter((item) => item.status === "confirmed").length,
    completed: requests.filter((item) => item.status === "completed").length,
  };
  const visible = requests.filter((item) => item.status === filter);
  const labels: {
    value: "pending" | "confirmed" | "completed";
    label: string;
  }[] = [
    { value: "pending", label: "Pending" },
    { value: "confirmed", label: "Approved" },
    { value: "completed", label: "Completed" },
  ];
  return (
    <>
      <Head
        label="FACULTY PORTAL"
        title="Appointment requests"
        copy="Review pending concerns, then track confirmed consultations through completion."
      />
      <div className="filter-tabs" aria-label="Request status filters">
        {labels.map((item) => (
          <button
            type="button"
            key={item.value}
            className={filter === item.value ? "active" : ""}
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label} {counts[item.value]}
          </button>
        ))}
      </div>
      <div className="request-list">
        {visible.map((request) => (
          <article key={request.id}>
            <div className="request-main">
              <span className="avatar mint">
                {request.student_name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)}
              </span>
              <div>
                <span className={`status ${request.status}`}>
                  {request.status.toUpperCase()}
                </span>
                <h3>{request.topic}</h3>
                <p>
                  {request.student_name}
                  {request.status !== "pending" && ` · ${request.location}`}
                </p>
              </div>
              <b className="request-time">
                {formatManilaDateTime(new Date(request.starts_at), {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </b>
            </div>
            {request.status === "pending" && (
              <>
                <div className="student-note">
                  <span>Student note</span>
                  <p>{request.notes}</p>
                </div>
                <div className="request-actions">
                  <button
                    className="outline"
                    onClick={() => void decide(request.id, "declined")}
                  >
                    Decline + email
                  </button>
                  <button
                    className="primary"
                    onClick={() => void decide(request.id, "confirmed")}
                  >
                    Accept + email ✓
                  </button>
                </div>
              </>
            )}
            {(request.status === "confirmed" || request.status === "completed") && (
              <div className="request-actions">
                <button
                  type="button"
                  className="outline"
                  onClick={() => downloadCalendarFile(appointmentCalendarDetails({
                    id: request.id,
                    facultyName,
                    topic: request.topic,
                    startsAt: request.starts_at,
                    endsAt: request.ends_at,
                    location: request.location,
                  }))}
                >
                  Download calendar (.ics)
                </button>
                <a
                  className="outline button-link"
                  href={googleCalendarUrl(appointmentCalendarDetails({
                    id: request.id,
                    facultyName,
                    topic: request.topic,
                    startsAt: request.starts_at,
                    endsAt: request.ends_at,
                    location: request.location,
                  }))}
                  target="_blank"
                  rel="noreferrer"
                >
                  Add to Google Calendar
                </a>
                {request.status === "confirmed" && (
                  <button
                    className="primary"
                    disabled={new Date(request.ends_at) > new Date()}
                    onClick={() => void complete(request.id)}
                  >
                    Mark completed
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {!visible.length && (
          <div className="empty-card">
            There are no {filter} consultation requests.
          </div>
        )}
      </div>
    </>
  );
}

type PresenceStatus = "active" | "recent" | "offline";
const ACTIVE_PRESENCE_WINDOW_MS = 2 * 60 * 1000;
const RECENT_PRESENCE_WINDOW_MS = 15 * 60 * 1000;

function presenceStatus(lastSeenAt: string | null, now = Date.now()): PresenceStatus {
  if (!lastSeenAt) return "offline";
  const age = Math.max(0, now - new Date(lastSeenAt).getTime());
  if (age <= ACTIVE_PRESENCE_WINDOW_MS) return "active";
  if (age <= RECENT_PRESENCE_WINDOW_MS) return "recent";
  return "offline";
}

function relativePresence(lastSeenAt: string | null, now = Date.now()) {
  if (!lastSeenAt) return "No portal activity recorded";
  const elapsed = Math.max(0, now - new Date(lastSeenAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function AdminPages({ view, user }: { view: AView; user: User }) {
  const [data, setData] = useState<AdminPortal>({
    users: [],
    appointments: [],
    faqs: [],
    reviews: [],
    chatbotGaps: [],
    emailNotifications: [],
    deliveryEvents: [],
    auditLogs: [],
    retentionPolicies: [],
    clientErrors: [],
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [presenceQuery, setPresenceQuery] = useState("");
  const [presenceFilter, setPresenceFilter] = useState<"all" | PresenceStatus>("all");
  const [presenceRole, setPresenceRole] = useState<"all" | Role>("all");
  const [appointmentFilter, setAppointmentFilter] = useState<
    "all" | AppointmentStatus
  >("all");
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewRatingFilter, setReviewRatingFilter] = useState<
    "all" | "positive" | "neutral" | "critical"
  >("all");
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  const [faqDraft, setFaqDraft] = useState({
    question: "",
    source: "",
    answer: "",
    category: "Consultation procedure",
    trainingPhrases: "",
    contentOwnerId: user.id,
    reviewIntervalDays: 180,
  });
  const [trainingQuestion, setTrainingQuestion] = useState("");
  const [trainingReply, setTrainingReply] = useState<ChatbotReply | null>(null);
  const [trainingTestLoading, setTrainingTestLoading] = useState(false);
  const [trainingCaptchaToken, setTrainingCaptchaToken] = useState("");
  const [trainingCaptchaGeneration, setTrainingCaptchaGeneration] = useState(0);
  const [trainingChatTrusted, setTrainingChatTrusted] = useState(false);
  const [trainingTrustExpiresAt, setTrainingTrustExpiresAt] = useState(0);
  const [trainingTrustLoading, setTrainingTrustLoading] = useState(
    Boolean(TURNSTILE_SITE_KEY),
  );
  const [trainingLibraryQuery, setTrainingLibraryQuery] = useState("");
  const [trainingLibraryStatus, setTrainingLibraryStatus] = useState<
    "all" | FaqStatus
  >("all");
  const refresh = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      setData(await loadAdminPortal());
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Administration data could not be loaded.",
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  };
  useEffect(() => {
    const backgroundRefresh = () => void refresh(false);
    void refresh(true);
    const interval = window.setInterval(backgroundRefresh, 60_000);
    window.addEventListener("focus", backgroundRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", backgroundRefresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    void getChatTrustStatus().then((status) => {
      if (!active) return;
      setTrainingChatTrusted(status.trusted);
      setTrainingTrustExpiresAt(
        status.trusted ? Date.now() + status.expiresInSeconds * 1000 : 0,
      );
      setTrainingTrustLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!trainingChatTrusted || !trainingTrustExpiresAt) return;
    const remaining = trainingTrustExpiresAt - Date.now();
    if (remaining <= 0) {
      setTrainingChatTrusted(false);
      setTrainingTrustExpiresAt(0);
      setTrainingCaptchaGeneration((value) => value + 1);
      return;
    }
    const timer = window.setTimeout(() => {
      setTrainingChatTrusted(false);
      setTrainingTrustExpiresAt(0);
      setTrainingCaptchaGeneration((value) => value + 1);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [trainingChatTrusted, trainingTrustExpiresAt]);
  const trainingCaptchaRequired =
    Boolean(TURNSTILE_SITE_KEY) && !trainingTrustLoading && !trainingChatTrusted;
  const changeRole = async (id: string, role: Role) => {
    try {
      await adminSetRole(id, role);
      setMessage("User role updated and recorded in the audit log.");
      await refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The role could not be changed.",
      );
    }
  };
  const changeAccountStatus = async (
    id: string,
    status: "active" | "suspended" | "deactivated",
  ) => {
    const reason = status === "active"
      ? "Account reactivated by an authorized administrator."
      : window.prompt(
          `Record the reason for ${status === "suspended" ? "suspending" : "deactivating"} this account:`,
          "Administrative review",
        );
    if (reason === null) return;
    if (status !== "active" && !reason.trim()) {
      setMessage("A reason is required when restricting an account.");
      return;
    }
    try {
      await adminSetAccountStatus(id, status, reason);
      setMessage(`Account ${status}. Existing sessions were revoked and the change was audited.`);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The account status could not be updated.");
    }
  };
  const saveFaq = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trainingPhrases = faqDraft.trainingPhrases
      .split("\n")
      .map((phrase) => phrase.trim())
      .filter(Boolean);
    try {
      if (editingFaqId) {
        await updateFaqEntry({
          faqId: editingFaqId,
          question: faqDraft.question,
          answer: faqDraft.answer,
          sourceReference: faqDraft.source,
          category: faqDraft.category,
          trainingPhrases,
          contentOwnerId: faqDraft.contentOwnerId,
          reviewIntervalDays: faqDraft.reviewIntervalDays,
        });
      } else {
        await createFaqEntry({
          userId: user.id,
          question: faqDraft.question,
          answer: faqDraft.answer,
          sourceReference: faqDraft.source,
          category: faqDraft.category,
          trainingPhrases,
          contentOwnerId: faqDraft.contentOwnerId,
          reviewIntervalDays: faqDraft.reviewIntervalDays,
        });
      }
      setFaqDraft({
        question: "",
        source: "",
        answer: "",
        category: "Consultation procedure",
        trainingPhrases: "",
        contentOwnerId: user.id,
        reviewIntervalDays: 180,
      });
      setEditingFaqId(null);
      setMessage(
        editingFaqId
          ? "Training entry updated and returned to draft for approval."
          : "Training entry saved as a draft for approval.",
      );
      await refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The FAQ draft could not be saved.",
      );
    }
  };
  const editFaq = (faq: FaqEntry) => {
    setEditingFaqId(faq.id);
    setFaqDraft({
      question: faq.question,
      source: faq.source_reference,
      answer: faq.answer,
      category: faq.category,
      trainingPhrases: (faq.training_phrases || []).join("\n"),
      contentOwnerId: faq.content_owner_id || faq.created_by,
      reviewIntervalDays: faq.review_interval_days || 180,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelFaqEdit = () => {
    setEditingFaqId(null);
    setFaqDraft({
      question: "",
      source: "",
      answer: "",
      category: "Consultation procedure",
      trainingPhrases: "",
      contentOwnerId: user.id,
      reviewIntervalDays: 180,
    });
  };
  const draftFromGap = (gap: ChatbotGap) => {
    const categoryByIntent: Record<string, string> = {
      availability: "Faculty availability",
      expertise: "Faculty expertise",
      booking: "Consultation procedure",
      location: "Consultation location",
      status: "Request status and changes",
      cancel: "Request status and changes",
      services: "CLIRDEC services",
      office_hours: "Office hours and contacts",
    };
    setEditingFaqId(null);
    setFaqDraft({
      question: gap.sample_question,
      source: "",
      answer: "",
      category: categoryByIntent[gap.detected_intent] || "Consultation procedure",
      trainingPhrases: `${gap.sample_question}\nPlease help me with: ${gap.sample_question}`,
      contentOwnerId: user.id,
      reviewIntervalDays: 180,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    setMessage("A training draft was started from the unanswered student question. Verify the official source before saving.");
  };
  const resolveGap = async (gap: ChatbotGap) => {
    try {
      await resolveChatbotGap(gap.id, user.id);
      setMessage("The unanswered question was marked reviewed.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The question could not be resolved.");
    }
  };
  const testTraining = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!PRODUCTION_SECURITY_READY) {
      setMessage("Chatbot testing is paused until the security check is configured.");
      return;
    }
    if (trainingTrustLoading) return;
    if (trainingCaptchaRequired && !trainingCaptchaToken) {
      setMessage("Complete the chatbot security check before running a live test.");
      return;
    }
    const question = trainingQuestion.trim();
    if (!question) return;
    setTrainingTestLoading(true);
    setTrainingReply(null);
    try {
      setTrainingReply(await requestChatbotReply(question, trainingCaptchaToken || undefined));
      if (trainingCaptchaToken) {
        const status = await getChatTrustStatus();
        setTrainingChatTrusted(status.trusted);
        setTrainingTrustExpiresAt(
          status.trusted ? Date.now() + status.expiresInSeconds * 1000 : 0,
        );
      }
    } catch (cause) {
      const status = cause instanceof ChatbotRequestError ? cause.status : 0;
      if (status === 403) {
        setTrainingChatTrusted(false);
        setTrainingTrustExpiresAt(0);
        setMessage("Complete the chatbot security check, then run the live test again.");
      } else if (status === 429) {
        setMessage("Too many chatbot tests were sent. Wait a moment, then try again.");
      } else {
        setMessage(
          "The chatbot test service is unavailable. Confirm the FastAPI deployment and VITE_CHATBOT_URL.",
        );
      }
      if (trainingCaptchaToken || status === 403) {
        setTrainingCaptchaGeneration((value) => value + 1);
      }
    } finally {
      if (trainingCaptchaToken) setTrainingCaptchaToken("");
      setTrainingTestLoading(false);
    }
  };
  const approve = async (id: string) => {
    try {
      await approveFaqEntry(id, user.id);
      setMessage("FAQ approved and available to the spaCy service.");
      await refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The FAQ could not be approved.",
      );
    }
  };
  const archive = async (id: string) => {
    try {
      await archiveFaqEntry(id);
      setMessage("FAQ archived and removed from chatbot answers.");
      await refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The FAQ could not be archived.",
      );
    }
  };
  if (loading)
    return (
      <PortalLoader
        compact
        label="Loading administration workspace"
        detail="Preparing users, consultation records, and service controls."
      />
    );
  const feedback = message && (
    <div className="notice" role="status" aria-live="polite">
      <b>✓</b>
      <span>{message}</span>
      <button type="button" aria-label="Dismiss message" onClick={() => setMessage("")}>×</button>
    </div>
  );
  const pending = data.appointments.filter(
    (item) => item.status === "pending",
  ).length;
  const confirmed = data.appointments.filter(
    (item) => item.status === "confirmed",
  ).length;
  const completed = data.appointments.filter(
    (item) => item.status === "completed",
  ).length;
  const filteredUsers = data.users.filter((item) =>
    (item.full_name + " " + item.email + " " + item.department + " " + item.role)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const presenceNow = Date.now();
  const presenceUsers = data.users.map((item) => ({
    ...item,
    presence: presenceStatus(item.last_seen_at, presenceNow),
  }));
  const presenceCounts = {
    active: presenceUsers.filter((item) => item.presence === "active").length,
    recent: presenceUsers.filter((item) => item.presence === "recent").length,
    offline: presenceUsers.filter((item) => item.presence === "offline").length,
  };
  const normalizedPresenceQuery = presenceQuery.trim().toLowerCase();
  const visiblePresenceUsers = presenceUsers
    .filter((item) => presenceFilter === "all" || item.presence === presenceFilter)
    .filter((item) => presenceRole === "all" || item.role === presenceRole)
    .filter((item) =>
      !normalizedPresenceQuery ||
      [item.full_name, item.email, item.department, item.role]
        .join(" ")
        .toLowerCase()
        .includes(normalizedPresenceQuery),
    )
    .sort((a, b) => {
      const rank: Record<PresenceStatus, number> = { active: 0, recent: 1, offline: 2 };
      return (
        rank[a.presence] - rank[b.presence] ||
        (b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0) -
          (a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0) ||
        a.full_name.localeCompare(b.full_name)
      );
    });
  const filteredAppointments =
    appointmentFilter === "all"
      ? data.appointments
      : data.appointments.filter((item) => item.status === appointmentFilter);
  const normalizedTrainingQuery = trainingLibraryQuery.trim().toLowerCase();
  const filteredTrainingEntries = data.faqs.filter((faq) => {
    const statusMatches =
      trainingLibraryStatus === "all" || faq.status === trainingLibraryStatus;
    const queryMatches =
      !normalizedTrainingQuery ||
      [
        faq.question,
        faq.answer,
        faq.category,
        faq.source_reference,
        ...(faq.training_phrases || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedTrainingQuery);
    return statusMatches && queryMatches;
  });
  const activeFaqs = data.faqs.filter((faq) => faq.status !== "archived");
  const approvedFaqs = data.faqs.filter((faq) => faq.status === "approved");
  const approvalQueue = data.faqs.filter(
    (faq) => faq.status === "draft" || faq.status === "review",
  );
  const trainingPhraseCount = activeFaqs.reduce(
    (total, faq) => total + (faq.training_phrases?.length || 0),
    0,
  );
  const coveredCategories = new Set(activeFaqs.map((faq) => faq.category)).size;
  const facultyDirectoryCount = data.users.filter(
    (portalUser) => portalUser.role === "faculty",
  ).length;
  const sourceReadyCount = approvedFaqs.filter(
    (faq) => faq.source_reference.trim().length > 0,
  ).length;
  const phraseReadyCount = approvedFaqs.filter(
    (faq) => (faq.training_phrases?.length || 0) >= 2,
  ).length;
  const readinessChecks = [
    approvedFaqs.length > 0,
    approvedFaqs.length > 0 && sourceReadyCount === approvedFaqs.length,
    approvedFaqs.length > 0 && phraseReadyCount === approvedFaqs.length,
    data.chatbotGaps.length === 0,
  ];
  const readinessPassed = readinessChecks.filter(Boolean).length;
  const todayKey = manilaDateKey(new Date());
  const todaysAppointments = data.appointments.filter(
    (item) =>
      item.status === "confirmed" &&
      manilaDateKey(new Date(item.starts_at)) === todayKey,
  );
  const activeAppointments = data.appointments.filter(
    (item) => item.status === "pending" || item.status === "confirmed",
  );
  const doubleBookings = Math.max(
    0,
    activeAppointments.length -
      new Set(activeAppointments.map((item) => item.availability_id)).size,
  );
  const reviewAverage = data.reviews.length
    ? data.reviews.reduce((sum, review) => sum + review.rating, 0) /
      data.reviews.length
    : 0;
  const reviewGroups = (field: "college" | "program" | "year_level") => {
    const groups = new Map<string, { count: number; total: number }>();
    data.reviews.forEach((review) => {
      const label = review[field]?.trim() || "Not provided";
      const current = groups.get(label) || { count: 0, total: 0 };
      groups.set(label, {
        count: current.count + 1,
        total: current.total + review.rating,
      });
    });
    return [...groups.entries()]
      .map(([label, values]) => ({
        label,
        count: values.count,
        average: values.total / values.count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  const appointmentById = new Map(
    data.appointments.map((appointment) => [appointment.id, appointment]),
  );
  const completedAppointments = data.appointments.filter(
    (appointment) => appointment.status === "completed",
  ).length;
  const writtenReviewCount = data.reviews.filter((review) =>
    Boolean(review.comment?.trim()),
  ).length;
  const positiveReviewCount = data.reviews.filter(
    (review) => review.rating >= 4,
  ).length;
  const criticalReviewCount = data.reviews.filter(
    (review) => review.rating <= 2,
  ).length;
  const reviewResponseRate = completedAppointments
    ? Math.min(100, (data.reviews.length / completedAppointments) * 100)
    : 0;
  const positiveReviewRate = data.reviews.length
    ? (positiveReviewCount / data.reviews.length) * 100
    : 0;
  const writtenReviewRate = data.reviews.length
    ? (writtenReviewCount / data.reviews.length) * 100
    : 0;
  const ratingDistribution = [5, 4, 3, 2, 1].map((rating) => {
    const count = data.reviews.filter((review) => review.rating === rating).length;
    return {
      rating,
      count,
      percentage: data.reviews.length ? (count / data.reviews.length) * 100 : 0,
    };
  });
  const averageForPeriod = (fromDaysAgo: number, toDaysAgo: number) => {
    const now = Date.now();
    const periodReviews = data.reviews.filter((review) => {
      const age = now - new Date(review.created_at).getTime();
      return age >= fromDaysAgo * 86_400_000 && age < toDaysAgo * 86_400_000;
    });
    return periodReviews.length
      ? periodReviews.reduce((sum, review) => sum + review.rating, 0) /
          periodReviews.length
      : null;
  };
  const currentReviewAverage = averageForPeriod(0, 30);
  const previousReviewAverage = averageForPeriod(30, 60);
  const reviewTrend =
    currentReviewAverage !== null && previousReviewAverage !== null
      ? currentReviewAverage - previousReviewAverage
      : null;
  const yearReviewGroups = reviewGroups("year_level");
  const collegeReviewGroups = reviewGroups("college");
  const programReviewGroups = reviewGroups("program");
  const statisticallyUsefulGroups = [
    ...collegeReviewGroups.map((row) => ({ ...row, kind: "College" })),
    ...programReviewGroups.map((row) => ({ ...row, kind: "Program" })),
  ].filter((row) => row.count >= 2);
  const strongestReviewGroup = [...statisticallyUsefulGroups].sort(
    (a, b) => b.average - a.average || b.count - a.count,
  )[0];
  const attentionReviewGroup = [...statisticallyUsefulGroups].sort(
    (a, b) => a.average - b.average || b.count - a.count,
  )[0];
  const normalizedReviewQuery = reviewQuery.trim().toLowerCase();
  const visibleReviews = data.reviews.filter((review) => {
    const ratingMatches =
      reviewRatingFilter === "all" ||
      (reviewRatingFilter === "positive" && review.rating >= 4) ||
      (reviewRatingFilter === "neutral" && review.rating === 3) ||
      (reviewRatingFilter === "critical" && review.rating <= 2);
    const appointment = appointmentById.get(review.appointment_id);
    const queryMatches =
      !normalizedReviewQuery ||
      [
        review.comment,
        review.year_level,
        review.college,
        review.program,
        appointment?.topic,
        appointment?.faculty_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedReviewQuery);
    return ratingMatches && queryMatches;
  });
  if (view === "ahome")
    return (
      <>
        {feedback}
        <Head
          label="MISO ADMINISTRATION"
          title="Service overview"
          copy="Monitor FacultyConnect activity, service quality, and access."
        />
        <Stats
          data={[
            [String(data.users.length), "Registered users"],
            [String(data.appointments.length), "Consultations"],
            [String(pending), "Pending requests"],
            [String(doubleBookings), "Active double bookings"],
          ]}
        />
        <div className="workspace-grid">
          <Work title="Today's appointments">
            {todaysAppointments.slice(0, 6).map((item) => (
              <Line
                key={item.id}
                a={formatManilaDateTime(new Date(item.starts_at), {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                b={item.topic}
                c={item.student_name}
              />
            ))}
            {!todaysAppointments.length && (
              <div className="empty-card">
                No confirmed consultations today.
              </div>
            )}
          </Work>
          <Work title="Service totals">
            <Line a="Now" b="Service data refreshed" c="Live Supabase records" />
            <Line
              a={String(
                data.faqs.filter((item) => item.status === "approved").length,
              )}
              b="Approved FAQ entries"
              c="Available to students"
            />
            <Line
              a={String(completed)}
              b="Completed consultations"
              c="Service records"
            />
          </Work>
        </div>
      </>
    );
  if (view === "activity")
    return (
      <>
        {feedback}
        <Head
          label="PORTAL PRESENCE"
          title="Currently active users"
          copy="Monitor recent authenticated portal activity across student, faculty, and administrator accounts."
        />
        <Stats
          data={[
            [String(presenceCounts.active), "Active now"],
            [String(presenceCounts.recent), "Recently active"],
            [String(presenceCounts.offline), "Offline"],
            [String(data.users.length), "Registered users"],
          ]}
        />
        <div className="scope-note presence-scope-note">
          <b><span className="presence-dot active" /> Privacy-conscious activity</b>
          <span>
            “Active now” means the authenticated portal sent a heartbeat within the
            last two minutes. FacultyConnect does not record page contents, typing,
            precise location, or activity outside this portal.
          </span>
        </div>
        <section className="presence-toolbar" aria-label="Active user filters">
          <div className="search-box">
            <span>⌕</span>
            <input
              value={presenceQuery}
              onChange={(event) => setPresenceQuery(event.target.value)}
              placeholder="Search name, email, department, or role"
              aria-label="Search active users"
            />
          </div>
          <label>
            <span>Role</span>
            <select
              value={presenceRole}
              onChange={(event) => setPresenceRole(event.target.value as "all" | Role)}
            >
              <option value="all">All roles</option>
              <option value="student">Students</option>
              <option value="faculty">Faculty</option>
              <option value="admin">Administrators</option>
            </select>
          </label>
        </section>
        <div className="filter-tabs presence-filter-tabs" aria-label="Activity status filters">
          {([
            ["all", "All", data.users.length],
            ["active", "Active now", presenceCounts.active],
            ["recent", "Recently active", presenceCounts.recent],
            ["offline", "Offline", presenceCounts.offline],
          ] as const).map(([status, label, count]) => (
            <button
              type="button"
              key={status}
              className={presenceFilter === status ? "active" : ""}
              aria-pressed={presenceFilter === status}
              onClick={() => setPresenceFilter(status)}
            >
              {label} {count}
            </button>
          ))}
        </div>
        <Data headings={["User", "Role", "Activity", "Last seen", "Account"]}>
          {visiblePresenceUsers.map((item) => (
            <div className="data-row presence-row" key={item.id}>
              <span data-label="User" className="presence-identity">
                <i>{item.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</i>
                <div>
                  <b>{item.full_name}</b>
                  <small>{item.email}</small>
                </div>
              </span>
              <span data-label="Role">
                <b>{item.role === "admin" ? "Administrator" : item.role === "faculty" ? "Faculty" : "Student"}</b>
                <small>{item.department || "Department not set"}</small>
              </span>
              <span data-label="Activity">
                <i className={`presence-pill ${item.presence}`}>
                  <span className={`presence-dot ${item.presence}`} />
                  {item.presence === "active" ? "Active now" : item.presence === "recent" ? "Recently active" : "Offline"}
                </i>
              </span>
              <span data-label="Last seen">
                <b>{relativePresence(item.last_seen_at, presenceNow)}</b>
                <small>{item.last_seen_at ? formatManilaDateTime(new Date(item.last_seen_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Waiting for first heartbeat"}</small>
              </span>
              <span data-label="Account">
                <b>{item.id === user.id ? "This administrator" : "Registered"}</b>
                <small>Joined {formatManilaDateTime(new Date(item.created_at), { month: "short", day: "numeric", year: "numeric" })}</small>
              </span>
            </div>
          ))}
          {!visiblePresenceUsers.length && (
            <div className="empty-card presence-empty">
              No users match the selected activity, role, and search filters.
            </div>
          )}
        </Data>
        <p className="presence-refresh-note">
          Activity refreshes automatically every minute. A user becomes offline
          after 15 minutes without a heartbeat.
        </p>
      </>
    );
  if (view === "users")
    return (
      <>
        {feedback}
        <Head
          label="MISO ADMINISTRATION"
          title="Manage users"
          copy="Students self-register with an accepted email domain. Faculty and administrator access is assigned through an audited role change."
        />
        <div className="scope-note registration-policy-note">
          <b>Student self-registration</b>
          <span>
            Verified <strong>@gmail.com</strong> and <strong>@clsu2.edu.ph</strong>
            addresses may create student accounts. Faculty and administrator
            roles remain MISO-controlled and cannot be selected during signup.
          </span>
        </div>
        <div className="search-box compact-search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or CLSU ID"
          />
        </div>
        <Data headings={["User", "Department", "Role", "Status", "Account action"]}>
          {filteredUsers.map((item) => {
            const itemPresence = presenceStatus(item.last_seen_at, presenceNow);
            return (
            <div className="data-row" key={item.id}>
              <span data-label="User">
                <b>{item.full_name}</b>
                <small>{item.id.slice(0, 8)}</small>
              </span>
              <span data-label="Department">
                {item.department || "Not set"}
              </span>
              <span data-label="Role">
                <select
                  className="role-select"
                  value={item.role}
                  disabled={item.id === user.id}
                  onChange={(e) =>
                    void changeRole(item.id, e.target.value as Role)
                  }
                >
                  <option value="student">Student</option>
                  <option value="faculty">Faculty</option>
                  <option value="admin">Administrator</option>
                </select>
              </span>
              <span data-label="Status">
                <i className={`account-status-pill ${item.account_status}`}>
                  {item.account_status}
                </i>
                <small>{item.account_status === "active" ? (itemPresence === "active" ? "Active now" : itemPresence === "recent" ? "Recently active" : "Offline") : item.status_reason || "Access restricted"}</small>
              </span>
              <span data-label="Account action" className="account-actions">
                {item.id === user.id ? (
                  <small>Current administrator</small>
                ) : item.account_status === "active" ? (
                  <>
                    <button type="button" className="outline" onClick={() => void changeAccountStatus(item.id, "suspended")}>Suspend</button>
                    <button type="button" className="danger-button" onClick={() => void changeAccountStatus(item.id, "deactivated")}>Deactivate</button>
                  </>
                ) : (
                  <button type="button" className="primary" onClick={() => void changeAccountStatus(item.id, "active")}>Reactivate</button>
                )}
              </span>
            </div>
            );
          })}
        </Data>
      </>
    );
  if (view === "appointments")
    return (
      <>
        {feedback}
        <Head
          label="MISO ADMINISTRATION"
          title="Manage appointments"
          copy="Monitor schedules and investigate service exceptions."
        />
        <div className="filter-tabs" aria-label="Appointment status filters">
          <button
            type="button"
            className={appointmentFilter === "all" ? "active" : ""}
            aria-pressed={appointmentFilter === "all"}
            onClick={() => setAppointmentFilter("all")}
          >
            All {data.appointments.length}
          </button>
          <button
            type="button"
            className={appointmentFilter === "confirmed" ? "active" : ""}
            aria-pressed={appointmentFilter === "confirmed"}
            onClick={() => setAppointmentFilter("confirmed")}
          >
            Confirmed {confirmed}
          </button>
          <button
            type="button"
            className={appointmentFilter === "pending" ? "active" : ""}
            aria-pressed={appointmentFilter === "pending"}
            onClick={() => setAppointmentFilter("pending")}
          >
            Pending {pending}
          </button>
          <button
            type="button"
            className={appointmentFilter === "cancelled" ? "active" : ""}
            aria-pressed={appointmentFilter === "cancelled"}
            onClick={() => setAppointmentFilter("cancelled")}
          >
            Cancelled{" "}
            {
              data.appointments.filter((item) => item.status === "cancelled")
                .length
            }
          </button>
        </div>
        <Data
          headings={["Consultation", "Participants", "Date and time", "Status"]}
          cls="appointment-row"
        >
          {filteredAppointments.map((item) => (
            <div className="data-row appointment-row" key={item.id}>
              <span data-label="Consultation">
                <b>{item.topic}</b>
                <small>
                  {item.consultation_mode === "online" ? "Online" : "In person"}
                </small>
              </span>
              <span data-label="Participants">
                {item.student_name}
                <small>{item.faculty_name}</small>
              </span>
              <span data-label="Date and time">
                {formatManilaDateTime(new Date(item.starts_at), {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span data-label="Status">
                <i
                  className={
                    item.status === "pending" ? "pending-pill" : "active-pill"
                  }
                >
                  {statusLabel(item.status)}
                </i>
              </span>
            </div>
          ))}
        </Data>
      </>
    );
  if (view === "knowledge")
    return (
      <>
        {feedback}
        <Head
          label="CHATBOT OPERATIONS"
          title="Build, verify, and improve Consult AI"
          copy="Manage approved answers, faculty discovery data, unanswered questions, and live response testing from one controlled workspace."
        />
        <section className="training-control-center" aria-label="Chatbot training overview">
          <article className="training-health-card">
            <div className="training-health-heading">
              <span className="training-live-indicator"><i /> Knowledge readiness</span>
              <b>{readinessPassed}/4 checks passed</b>
            </div>
            <h2>{data.chatbotGaps.length ? "Improve the unanswered-question queue" : "Knowledge base is ready for testing"}</h2>
            <p>
              Consult AI combines source-backed answers with live faculty profiles and
              published schedules. Only approved entries are used as official answers.
            </p>
            <div className="training-readiness-track" aria-hidden="true">
              <i style={{ width: `${readinessPassed * 25}%` }} />
            </div>
            <ul className="training-readiness-list">
              <li className={readinessChecks[0] ? "complete" : ""}>Approved answer available</li>
              <li className={readinessChecks[1] ? "complete" : ""}>Every live answer cites a source</li>
              <li className={readinessChecks[2] ? "complete" : ""}>At least two phrases per live answer</li>
              <li className={readinessChecks[3] ? "complete" : ""}>Unanswered queue reviewed</li>
            </ul>
          </article>
          <div className="training-metric-grid">
            <article><span>Live answers</span><b>{approvedFaqs.length}</b><small>Available to students now</small></article>
            <article><span>Approval queue</span><b>{approvalQueue.length}</b><small>Drafts and review items</small></article>
            <article><span>Example phrases</span><b>{trainingPhraseCount}</b><small>English and Filipino wording</small></article>
            <article className={data.chatbotGaps.length ? "attention" : ""}><span>Knowledge gaps</span><b>{data.chatbotGaps.length}</b><small>Low-confidence questions</small></article>
          </div>
        </section>
        <section className="training-source-map" aria-labelledby="training-source-title">
          <header>
            <div><span className="section-kicker">CONNECTED KNOWLEDGE</span><h2 id="training-source-title">What Consult AI can use</h2></div>
            <p>Operational data stays live in its source table; approved answers stay in the controlled training library.</p>
          </header>
          <div>
            <article><i aria-hidden="true">01</i><span><b>Approved answer library</b><small>{approvedFaqs.length} live answers across {coveredCategories} categories</small></span><em>Admin controlled</em></article>
            <article><i aria-hidden="true">02</i><span><b>Faculty expertise directory</b><small>{facultyDirectoryCount} faculty accounts; expertise comes from completed profiles</small></span><em>Live database</em></article>
            <article><i aria-hidden="true">03</i><span><b>Availability and booking rules</b><small>Published schedules, consultation modes, and request workflow</small></span><em>Live database</em></article>
            <article><i aria-hidden="true">04</i><span><b>Unanswered-question signals</b><small>Repeated low-confidence wording is prioritized for review</small></span><em>Privacy filtered</em></article>
          </div>
        </section>
        <nav className="training-jump-nav" aria-label="Chatbot training sections">
          <a href="#training-editor">Create answer</a>
          <a href="#training-tester">Test response</a>
          <a href="#training-gaps">Review gaps <b>{data.chatbotGaps.length}</b></a>
          <a href="#training-library">Training library <b>{data.faqs.length}</b></a>
        </nav>
        <div className="knowledge-layout chatbot-training-layout training-studio">
          <div id="training-editor" className="training-editor-card">
          <Work title={editingFaqId ? "Edit source-backed answer" : "Create a source-backed answer"}>
            <div className="training-editor-guidance">
              <b>Publication requirements</b>
              <span>Clear question</span><span>Verified source</span><span>Approved wording</span><span>2–20 examples</span>
            </div>
            <form className="knowledge-form training-entry-form" onSubmit={saveFaq}>
              <label>
                <span className="training-field-title"><i>1</i> Canonical student question</span>
                <input
                  name="question"
                  required
                  value={faqDraft.question}
                  onChange={(event) =>
                    setFaqDraft((draft) => ({ ...draft, question: event.target.value }))
                  }
                  placeholder="How do I request a faculty consultation?"
                  maxLength={500}
                />
                <small>Use the clearest version of the student’s intent, not every possible variation.</small>
              </label>
              <label>
                <span className="training-field-title"><i>2</i> Official source or evidence</span>
                <input
                  name="source"
                  required
                  value={faqDraft.source}
                  onChange={(event) =>
                    setFaqDraft((draft) => ({ ...draft, source: event.target.value }))
                  }
                  placeholder="Official page, advisory, procedure, or faculty schedule"
                  maxLength={500}
                />
                <small>Name the policy, advisory, office page, or accountable faculty source. Unsourced entries cannot be approved.</small>
              </label>
              <label>
                <span className="training-field-title"><i>3</i> Student-facing answer</span>
                <textarea
                  name="answer"
                  required
                  value={faqDraft.answer}
                  onChange={(event) =>
                    setFaqDraft((draft) => ({ ...draft, answer: event.target.value }))
                  }
                  placeholder="Write the verified response"
                  maxLength={5000}
                />
                <small>Give the direct answer first, followed by the next step, office, or booking action.</small>
              </label>
              <label>
                <span className="training-field-title"><i>4</i> Example questions and phrases</span>
                <textarea
                  name="trainingPhrases"
                  required
                  value={faqDraft.trainingPhrases}
                  onChange={(event) =>
                    setFaqDraft((draft) => ({
                      ...draft,
                      trainingPhrases: event.target.value,
                    }))
                  }
                  placeholder={"How can I book?\nPaano magpa-schedule?\nI need a consultation"}
                  maxLength={4000}
                />
                <small>Enter 2–20 natural variations, one per line. English and Filipino are supported.</small>
              </label>
              <label>
                <span className="training-field-title"><i>5</i> Intent category</span>
                <select
                  name="category"
                  value={faqDraft.category}
                  onChange={(event) =>
                    setFaqDraft((draft) => ({ ...draft, category: event.target.value }))
                  }
                >
                  <option>Office hours and contacts</option>
                  <option>Consultation procedure</option>
                  <option>Faculty availability</option>
                  <option>Faculty expertise</option>
                  <option>Consultation location</option>
                  <option>Request status and changes</option>
                  <option>CLIRDEC services</option>
                </select>
                <small>The category organizes the library and shows which student needs are covered.</small>
              </label>
              <div className="training-governance-fields">
                <label>
                  <span className="training-field-title"><i>6</i> Content owner</span>
                  <select value={faqDraft.contentOwnerId} onChange={(event) => setFaqDraft((draft) => ({ ...draft, contentOwnerId: event.target.value }))}>
                    {data.users.filter((entry) => entry.role !== "student" && entry.account_status === "active").map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.full_name} · {entry.role}</option>
                    ))}
                  </select>
                  <small>The faculty member or administrator accountable for future verification.</small>
                </label>
                <label>
                  <span className="training-field-title"><i>7</i> Review frequency</span>
                  <select value={faqDraft.reviewIntervalDays} onChange={(event) => setFaqDraft((draft) => ({ ...draft, reviewIntervalDays: Number(event.target.value) }))}>
                    <option value={90}>Every 90 days</option>
                    <option value={180}>Every 180 days</option>
                    <option value={365}>Every year</option>
                  </select>
                  <small>The approved source must be checked again after this period.</small>
                </label>
              </div>
              <div className="training-form-actions">
                <button className="primary">
                  {editingFaqId ? "Save changes as draft" : "Save training draft"}
                </button>
                {editingFaqId && (
                  <button type="button" className="outline" onClick={cancelFaqEdit}>
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
          </Work>
          </div>
          <div id="training-tester" className="training-tester-card">
          <Work title="Test the live chatbot">
            <div className="training-test-panel" aria-live="polite">
              <p>
                Use the same endpoint students use. Test exact wording, paraphrases,
                abbreviations, and Filipino questions before a pilot session.
              </p>
              <div className="training-test-prompts" aria-label="Suggested test questions">
                {["Find a faculty adviser", "How do I book?", "Saan ang consultation?"].map((prompt) => (
                  <button type="button" key={prompt} onClick={() => setTrainingQuestion(prompt)}>{prompt}</button>
                ))}
              </div>
              {!PRODUCTION_SECURITY_READY && (
                <p className="training-security-warning" role="status">
                  The live chatbot test is paused until the Turnstile site key is configured.
                </p>
              )}
              {TURNSTILE_SITE_KEY && trainingTrustLoading && (
                <p className="training-security-status" role="status">
                  Checking secure chatbot session...
                </p>
              )}
              {TURNSTILE_SITE_KEY && !trainingTrustLoading && trainingChatTrusted && (
                <p className="chat-trust-active training-trust-active" role="status">
                  <span aria-hidden="true">✓</span>
                  Protected live test session active
                </p>
              )}
              {trainingCaptchaRequired && (
                <div className={`turnstile-field training-turnstile${trainingCaptchaToken ? " is-complete" : ""}`}>
                  <div className="turnstile-widget-shell" aria-hidden={Boolean(trainingCaptchaToken)}>
                    <Turnstile
                      key={trainingCaptchaGeneration}
                      siteKey={TURNSTILE_SITE_KEY}
                      options={{ theme: "light", size: "flexible", action: "admin_chatbot_test" }}
                      onSuccess={setTrainingCaptchaToken}
                      onExpire={() => setTrainingCaptchaToken("")}
                      onError={() => setTrainingCaptchaToken("")}
                    />
                  </div>
                  {trainingCaptchaToken && (
                    <p className="turnstile-confirmed" role="status">
                      <span aria-hidden="true">✓</span>
                      Security check complete
                    </p>
                  )}
                </div>
              )}
              <form onSubmit={testTraining}>
                <label htmlFor="training-test-question">Student test question</label>
                <div>
                  <input
                    id="training-test-question"
                    value={trainingQuestion}
                    onChange={(event) => setTrainingQuestion(event.target.value)}
                    placeholder="Ask a realistic student question"
                    maxLength={500}
                  />
                  <button
                    className="primary"
                    disabled={
                      trainingTestLoading ||
                      trainingTrustLoading ||
                      !PRODUCTION_SECURITY_READY ||
                      (trainingCaptchaRequired && !trainingCaptchaToken)
                    }
                  >
                    {trainingTestLoading ? "Testing…" : "Run test"}
                  </button>
                </div>
              </form>
              {trainingReply ? (
                <article className={trainingReply.escalation ? "test-result needs-review" : "test-result"}>
                  <header>
                    <span>{trainingReply.escalation ? "Needs staff referral" : "Approved response"}</span>
                    <strong>{Math.round(trainingReply.confidence * 100)}% confidence</strong>
                  </header>
                  <p>{trainingReply.answer}</p>
                  <dl>
                    <div><dt>Intent</dt><dd>{trainingReply.intent.replace(/_/g, " ")}</dd></div>
                    <div><dt>Source</dt><dd>{trainingReply.source || "No source returned"}</dd></div>
                  </dl>
                </article>
              ) : (
                <div className="training-test-empty">
                  <span className="training-empty-symbol" aria-hidden="true">AI</span>
                  <b>No test has been run yet</b>
                  <span>Results show the matched intent, source, confidence, and escalation behavior.</span>
                </div>
              )}
              <aside className="training-test-checklist">
                <b>What a safe response needs</b>
                <span>Correct intent and current source</span>
                <span>Useful next step for the student</span>
                <span>Staff referral when confidence is low</span>
              </aside>
            </div>
          </Work>
          </div>
        </div>
        <div id="training-gaps" className="training-gap-workspace">
        <Work title="Unanswered student questions">
          <div className="chatbot-gap-intro">
            <p>
              Low-confidence questions are collected without email addresses or long
              identification numbers. Repeated wording rises to the top so MISO can
              address the largest knowledge gaps first.
            </p>
            <b className={data.chatbotGaps.length ? "attention" : ""}>{data.chatbotGaps.length} need review</b>
          </div>
          <div className="chatbot-gap-list">
            {data.chatbotGaps.map((gap) => (
              <article key={gap.id}>
                <div>
                  <span>{gap.detected_intent.replace(/_/g, " ")}</span>
                  <b>{gap.sample_question}</b>
                  <small>
                    Asked {gap.occurrence_count} {gap.occurrence_count === 1 ? "time" : "times"}
                    {" · "}last seen {formatManilaDateTime(new Date(gap.last_seen_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </small>
                </div>
                <div className="chatbot-gap-actions">
                  <button type="button" className="primary" onClick={() => draftFromGap(gap)}>Create training draft</button>
                  <button type="button" className="outline" onClick={() => void resolveGap(gap)}>Mark reviewed</button>
                </div>
              </article>
            ))}
            {!data.chatbotGaps.length && (
              <div className="empty-card">No unresolved chatbot questions have been recorded.</div>
            )}
          </div>
        </Work>
        </div>
        <div id="training-library" className="training-library-workspace">
        <Work title="Training library and approval queue">
          <div className="training-library-note">
            <span>Editing an approved entry returns it to draft so a second source check is required.</span>
            <b>{filteredTrainingEntries.length} of {data.faqs.length} entries</b>
          </div>
          <div className="training-library-toolbar">
            <label>
              <span className="sr-only">Search training entries</span>
              <input
                type="search"
                value={trainingLibraryQuery}
                onChange={(event) => setTrainingLibraryQuery(event.target.value)}
                placeholder="Search questions, answers, sources, or phrases"
              />
            </label>
            <div role="group" aria-label="Filter training entries by status">
              {([
                ["all", "All"],
                ["approved", "Live"],
                ["draft", "Drafts"],
                ["review", "In review"],
                ["archived", "Archived"],
              ] as const).map(([status, label]) => (
                <button
                  type="button"
                  key={status}
                  className={trainingLibraryStatus === status ? "active" : ""}
                  aria-pressed={trainingLibraryStatus === status}
                  onClick={() => setTrainingLibraryStatus(status)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
            <div className="faq-list">
              {filteredTrainingEntries.map((faq: FaqEntry) => (
                <article key={faq.id}>
                  <span className={`faq-status ${faq.status}`}>{faq.status === "approved" ? "live" : faq.status}</span>
                  <div className="faq-copy">
                    <b>{faq.question}</b>
                    <small>{faq.category} · {faq.source_reference}</small>
                    <p>{faq.answer}</p>
                    <small className={faq.review_due_at && new Date(faq.review_due_at).getTime() < Date.now() ? "freshness overdue" : "freshness"}>
                      {faq.status === "approved"
                        ? faq.review_due_at
                          ? `Review ${new Date(faq.review_due_at).getTime() < Date.now() ? "overdue" : "due"} ${formatManilaDateTime(new Date(faq.review_due_at), { month: "short", day: "numeric", year: "numeric" })}`
                          : "Review date not assigned"
                        : `Review every ${faq.review_interval_days || 180} days after approval`}
                    </small>
                    <div className="phrase-chips">
                      {(faq.training_phrases || []).slice(0, 4).map((phrase) => (
                        <em key={phrase}>{phrase}</em>
                      ))}
                      {(faq.training_phrases?.length || 0) > 4 && (
                        <em>+{faq.training_phrases.length - 4} more</em>
                      )}
                    </div>
                  </div>
                  <div className="faq-actions">
                    {faq.status !== "archived" && (
                      <button onClick={() => editFaq(faq)}>Edit</button>
                    )}
                    {faq.status !== "approved" && faq.status !== "archived" && (
                      <button onClick={() => void approve(faq.id)}>
                        Approve
                      </button>
                    )}
                    {faq.status !== "archived" && (
                      <button onClick={() => void archive(faq.id)}>
                        Archive
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!filteredTrainingEntries.length && (
                <div className="empty-card">
                  {data.faqs.length
                    ? "No training entries match this search or status filter."
                    : "No training entries yet. Add a source-backed answer to begin."}
                </div>
              )}
            </div>
        </Work>
        </div>
      </>
    );
  if (view === "reviews")
    return (
      <>
        {feedback}
        <Head
          label="SERVICE EXPERIENCE"
          title="Reviews and insights"
          copy="Monitor post-consultation ratings and comments alongside the students’ year level, college, and course."
        />
        <Stats
          data={[
            [reviewAverage ? reviewAverage.toFixed(1) : "—", "Average rating"],
            [`${reviewResponseRate.toFixed(0)}%`, "Review response rate"],
            [`${positiveReviewRate.toFixed(0)}%`, "Positive ratings"],
            [String(criticalReviewCount), "Ratings needing attention"],
          ]}
        />
        <section className="review-insight-grid" aria-label="Review summary">
          <article className="review-analysis-card">
            <div className="card-title">
              <div>
                <p className="eyebrow">RATING MIX</p>
                <h2>Rating distribution</h2>
              </div>
              <b>{data.reviews.length} total</b>
            </div>
            <div className="rating-distribution">
              {ratingDistribution.map((row) => (
                <div className="rating-distribution-row" key={row.rating}>
                  <span>{row.rating} ★</span>
                  <i aria-hidden="true">
                    <b style={{ width: `${row.percentage}%` }} />
                  </i>
                  <strong>{row.count}</strong>
                </div>
              ))}
            </div>
          </article>
          <article className="review-analysis-card">
            <div className="card-title">
              <div>
                <p className="eyebrow">SERVICE SIGNALS</p>
                <h2>What needs attention</h2>
              </div>
            </div>
            <div className="review-signal-grid">
              <div>
                <span>30-day rating trend</span>
                <b>
                  {reviewTrend === null
                    ? "More data needed"
                    : `${reviewTrend >= 0 ? "+" : ""}${reviewTrend.toFixed(1)} ★`}
                </b>
                <small>Compared with the previous 30 days</small>
              </div>
              <div>
                <span>Written feedback</span>
                <b>{writtenReviewRate.toFixed(0)}%</b>
                <small>{writtenReviewCount} reviews include a comment</small>
              </div>
              <div>
                <span>Strongest segment</span>
                <b>{strongestReviewGroup?.label || "More data needed"}</b>
                <small>
                  {strongestReviewGroup
                    ? `${strongestReviewGroup.kind} · ${strongestReviewGroup.average.toFixed(1)} ★ from ${strongestReviewGroup.count}`
                    : "At least two reviews per segment are required"}
                </small>
              </div>
              <div className={criticalReviewCount ? "attention" : ""}>
                <span>Lowest-rated segment</span>
                <b>{attentionReviewGroup?.label || "No reliable signal yet"}</b>
                <small>
                  {attentionReviewGroup
                    ? `${attentionReviewGroup.kind} · ${attentionReviewGroup.average.toFixed(1)} ★ from ${attentionReviewGroup.count}`
                    : "At least two reviews per segment are required"}
                </small>
              </div>
            </div>
          </article>
        </section>
        <section className="review-breakdowns">
          <ReviewBreakdown title="By year level" rows={yearReviewGroups} />
          <ReviewBreakdown title="By college or unit" rows={collegeReviewGroups} />
          <ReviewBreakdown title="By course or program" rows={programReviewGroups} />
        </section>
        <Work title="Review records">
          <div className="review-toolbar">
            <label>
              <span className="sr-only">Search review records</span>
              <input
                type="search"
                value={reviewQuery}
                onChange={(event) => setReviewQuery(event.target.value)}
                placeholder="Search comments, topic, faculty, year, college, or course"
              />
            </label>
            <div className="filter-tabs" aria-label="Filter reviews by rating">
              {(
                [
                  ["all", "All"],
                  ["positive", "4–5 stars"],
                  ["neutral", "3 stars"],
                  ["critical", "1–2 stars"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={reviewRatingFilter === value ? "active" : ""}
                  aria-pressed={reviewRatingFilter === value}
                  onClick={() => setReviewRatingFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="review-result-count" role="status">
            Showing {visibleReviews.length} of {data.reviews.length} review records
          </p>
          <div className="admin-review-list">
            {visibleReviews.map((review) => {
              const appointment = appointmentById.get(review.appointment_id);
              return (
                <article
                  key={review.id}
                  className={review.rating <= 2 ? "review-critical" : review.rating >= 4 ? "review-positive" : ""}
                >
                  <div className="admin-review-head">
                    <span aria-label={`${review.rating} out of 5 stars`}>
                      {"★".repeat(review.rating)}
                      <i>{"★".repeat(5 - review.rating)}</i>
                    </span>
                    <time dateTime={review.created_at}>
                      {formatManilaDateTime(new Date(review.created_at), {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </time>
                  </div>
                  <b>{appointment?.topic || "Completed consultation"}</b>
                  <small>
                    {appointment?.faculty_name || "Faculty member"} · {review.year_level || "Year not provided"} · {review.college || "College not provided"} · {review.program || "Course not provided"}
                  </small>
                  <p>{review.comment || "No written comment was provided."}</p>
                </article>
              );
            })}
            {!visibleReviews.length && (
              <div className="empty-card">
                {data.reviews.length
                  ? "No review records match the current search and rating filter."
                  : "No completed-consultation reviews have been submitted yet."}
              </div>
            )}
          </div>
        </Work>
      </>
    );
  if (view === "operations")
    return (
      <>
        {feedback}
        <AdminOperations
          data={data}
          onRefresh={() => refresh(false)}
          onMessage={setMessage}
        />
      </>
    );
  return (
    <>
      {feedback}
      <Head
        label="MISO ADMINISTRATION"
        title="Administration workspace"
        copy="Choose an administration section from the navigation."
      />
    </>
  );
}
function ReviewBreakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number; average: number }>;
}) {
  return (
    <section className="review-breakdown-card">
      <div className="card-title">
        <h2>{title}</h2>
      </div>
      <div className="review-breakdown-list">
        {rows.map((row) => (
          <div key={row.label}>
            <span>
              <b>{row.label}</b>
              <small>{row.count} review{row.count === 1 ? "" : "s"}</small>
            </span>
            <strong>{row.average.toFixed(1)} ★</strong>
          </div>
        ))}
        {!rows.length && <p>No review data yet.</p>}
      </div>
    </section>
  );
}
function Work({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="work-card">
      <div className="card-title">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function Line({ a, b, c }: { a: string; b: string; c: string }) {
  return (
    <div className="timeline-line">
      <span>{a}</span>
      <i />
      <p>
        <b>{b}</b>
        <small>{c}</small>
      </p>
    </div>
  );
}
function Info({ l, v }: { l: string; v: string }) {
  return (
    <div className="info">
      <span>{l}</span>
      <p>{v}</p>
    </div>
  );
}
function Data({
  headings,
  children,
  cls = "",
}: {
  headings: string[];
  children: ReactNode;
  cls?: string;
}) {
  return (
    <section className="data-card">
      <div className={`data-row data-head ${cls}`}>
        {headings.map((h) => (
          <b key={h}>{h}</b>
        ))}
      </div>
      {children}
    </section>
  );
}
export default App;
