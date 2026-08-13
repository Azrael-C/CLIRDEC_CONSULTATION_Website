import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { supabase, configured } from "./supabase";
import {
  adminSetRole,
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
  rescheduleAppointment,
  submitConsultationReview,
  updateFaqEntry,
  updateFacultyProfile,
  type AdminPortal,
  type AppointmentStatus,
  type ConsultationReview,
  type FaqEntry,
  type FacultyAvailability,
  type FacultyProfile,
  type FacultyRequest,
} from "./backend";
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
  overlapsExisting,
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
};
type Slot = {
  id: string;
  faculty_name: string;
  initials: string;
  expertise: string;
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
};

type ChatbotReply = {
  answer: string;
  intent: string;
  confidence: number;
  escalation: boolean;
  source?: string;
  suggestions?: string[];
};

type AuthAction = "login" | "signup" | "reset";

const STUDENT_EMAIL_DOMAINS = ["gmail.com", "clsu2.edu.ph"] as const;
const TURNSTILE_SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "");

async function requestChatbotReply(message: string, captchaToken?: string): Promise<ChatbotReply> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (data.session?.access_token)
    headers.Authorization = `Bearer ${data.session.access_token}`;
  if (captchaToken) headers["X-Turnstile-Token"] = captchaToken;
  const configuredBase = String(import.meta.env.VITE_CHATBOT_URL || "").replace(
    /\/$/,
    "",
  );
  const chatbotBase =
    configuredBase || (import.meta.env.PROD ? "/api" : "http://localhost:8000");
  const response = await fetch(`${chatbotBase}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error(`Assistant returned ${response.status}`);
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
          "full_name,role,department,student_number,college,program,year_level,email_notifications",
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
        (s.faculty_name + " " + s.expertise)
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
      return;
    }
    if (!email || !email.includes("@")) {
      setNotice("Enter your registered email address first.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
      captchaToken,
    });
    setNotice(
      error
        ? friendlyAuthError(error.message, "reset")
        : "Check your email for the secure password-reset link.",
    );
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
    setUser(null);
    setView("home");
    setNotice("");
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
  async function ask(e: FormEvent, captchaToken?: string) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
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
        },
      ]);
    } catch {
      setChat((c) => [
        ...c,
        {
          who: "bot",
          text: "The assistant is temporarily offline. Please use the official CLIRDEC contact channel or try again later.",
          escalation: true,
        },
      ]);
    }
  }
  if (
    pathname === "/privacy" ||
    pathname === "/privacy-policy" ||
    pathname === "/privacy-policy.html"
  )
    return <PrivacyPolicyPage />;
  if (pathname !== "/") return <NotFoundPage />;
  if (authLoading)
    return (
      <main className="auth-loading" id="main-content">
        <p>Loading FacultyConnect…</p>
      </main>
    );
  if (recoveringPassword)
    return <PasswordRecovery save={updateRecoveredPassword} notice={notice} />;
  if (!user)
    return (
      <ProductionAuth
        login={login}
        signup={signup}
        resetPassword={requestPasswordReset}
        clearNotice={() => setNotice("")}
        notice={notice}
      />
    );
  if (user.role !== "student")
    return <RoleWorkspace user={user} logout={logout} />;
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
            label="Ask Consult AI"
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
  resetPassword,
  clearNotice,
  notice,
}: {
  login: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  signup: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  resetPassword: (email: string, captchaToken?: string) => Promise<void>;
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
            <div className="turnstile-field">
              <Turnstile
                key={captchaGeneration}
                siteKey={TURNSTILE_SITE_KEY}
                options={{ theme: "light", size: "flexible", action: creating ? "student_signup" : "portal_login" }}
                onSuccess={setCaptchaToken}
                onExpire={() => setCaptchaToken("")}
                onError={() => setCaptchaToken("")}
              />
              <input type="hidden" name="captcha_token" value={captchaToken} />
            </div>
          )}
          <button
            className="primary"
            disabled={
              submittingAuth ||
              (Boolean(TURNSTILE_SITE_KEY) && !captchaToken) ||
              (creating && (!passwordValid || !passwordsMatch))
            }
          >
            {submittingAuth
              ? creating
                ? "Creating account…"
                : "Signing in…"
              : creating
                ? "Create student account"
                : "Log in"}
          </button>
          <div className="auth-options">
            {!creating && (
              <button
                type="button"
                className="auth-option"
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (form)
                    void resetPassword(
                      String(new FormData(form).get("email") || ""),
                      captchaToken || undefined,
                    ).finally(() => {
                      setCaptchaToken("");
                      setCaptchaGeneration((value) => value + 1);
                    });
                }}
              >
                <b>Forgot your password?</b>
                <small>
                  Enter your email above to receive a secure reset link.
                </small>
              </button>
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
          <h2>Set your new password</h2>
          <label>
            New password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="recovery-password-rules"
              aria-invalid={password.length > 0 && !valid}
            />
          </label>
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
          <label>
            Confirm password
            <input
              name="confirmation"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={confirmation.length > 0 && !matches}
            />
          </label>
          <button className="primary" disabled={saving || !valid || !matches}>
            {saving ? "Updating…" : "Update password"}
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
          Ask Consult AI <span>→</span>
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
              <b>Ask Consult AI</b>
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
            You have no consultation requests. Ask Consult AI for the approved
            procedure or view faculty availability.
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
  ask: (e: FormEvent, captchaToken?: string) => Promise<void>;
}) {
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaGeneration, setCaptchaGeneration] = useState(0);
  const submit = async (event: FormEvent) => {
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      event.preventDefault();
      return;
    }
    await ask(event, captchaToken || undefined);
    setCaptchaToken("");
    setCaptchaGeneration((value) => value + 1);
  };
  return (
    <>
      <section className="page-head compact">
        <div>
          <p className="eyebrow">VERIFIED CONSULTATION GUIDANCE</p>
          <h1>Ask Consult AI</h1>
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
        <div className="chat-head">
          <span className="ai-mark">✦</span>
          <div>
            <b>Consult AI</b>
            <small>Online · Approved CLIRDEC knowledge base</small>
          </div>
        </div>
        <div className="messages">
          {chat.map((m, i) => (
            <div key={i} className={`message-wrap ${m.who}`}>
              <p>{m.text}</p>
              {m.who === "bot" && m.source && <small>Source: {m.source}</small>}
              {m.escalation && (
                <small className="escalation-note">
                  Staff follow-up recommended
                </small>
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
          />
          {TURNSTILE_SITE_KEY && (
            <Turnstile
              key={captchaGeneration}
              siteKey={TURNSTILE_SITE_KEY}
              options={{ theme: "light", size: "flexible", action: "chatbot_question" }}
              onSuccess={setCaptchaToken}
              onExpire={() => setCaptchaToken("")}
              onError={() => setCaptchaToken("")}
            />
          )}
          <button className="primary">Send →</button>
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
  | "appointments"
  | "reviews"
  | "knowledge"
  | "reports";
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
    appointments: ["Consultation logs | CLSU FacultyConnect", "Review consultation status, participants, schedules, and service exceptions."],
    reviews: ["Reviews and insights | CLSU FacultyConnect", "Analyze consultation ratings and comments by year level, college, and course."],
    knowledge: ["Chatbot training | CLSU FacultyConnect", "Train and test the consultation assistant with approved answers, example phrases, and official sources."],
    reports: ["Quality assurance | CLSU FacultyConnect", "Track service acceptance criteria, quality targets, and release evidence."],
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
        ["appointments", "Consultation logs", "calendar"],
        ["reviews", "Reviews and insights", "report"],
        ["reports", "Quality assurance", "report"],
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
                ["appointments", "Logs", "calendar"],
                ["reviews", "Reviews", "report"],
                ["reports", "QA", "calendar"],
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
  action?: string;
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
                const conflict = overlapsExisting(start, cellEnd, slots);
                const reason = availabilityValidationMessage(
                  start,
                  end,
                  slots,
                  now,
                );
                const selected = selectedTime === start.getTime();
                const state = conflict
                  ? "Published"
                  : reason
                    ? "Unavailable"
                    : selected
                      ? "Selected"
                      : "Available";
                return (
                  <button
                    type="button"
                    key={day}
                    className={`slot-toggle${selected ? " selected" : ""}${conflict ? " occupied" : ""}`}
                    disabled={Boolean(reason)}
                    onClick={() => setSelectedStart(start)}
                    title={reason || `Select ${formatTime(minutes)}`}
                    aria-label={`${formatCalendarDay(day, { weekday: "long", month: "long", day: "numeric" })} at ${formatTime(minutes)} — ${state}`}
                  >
                    <span>
                      {conflict ? "Busy" : selected ? "Selected" : ""}
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
function FacultyPages({ view, user }: { view: FView; user: User }) {
  const [requests, setRequests] = useState<FacultyRequest[]>([]);
  const [facultySlots, setFacultySlots] = useState<FacultyAvailability[]>([]);
  const [profile, setProfile] = useState<FacultyProfile>({
    expertise: [],
    bio: "",
    active: true,
  });
  const [loading, setLoading] = useState(configured);
  const [message, setMessage] = useState("");
  const [requestFilter, setRequestFilter] = useState<
    "pending" | "confirmed" | "completed"
  >("pending");
  const [calendarWeek, setCalendarWeek] = useState(() => initialCalendarWeek());
  const [selectedStart, setSelectedStart] = useState<Date | null>(null);
  const [duration, setDuration] = useState(30);
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
        consultationMode: String(form.get("consultation_mode")) as
          | "in_person"
          | "online",
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
        bio: String(form.get("bio") || ""),
      });
      setMessage("Faculty profile updated for student search.");
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
    return <div className="empty-card">Loading your faculty workspace…</div>;
  const feedback = message && (
    <div className="notice" role="status" aria-live="polite">
      <b>✓</b>
      <span>{message}</span>
      <button type="button" aria-label="Dismiss message" onClick={() => setMessage("")}>×</button>
    </div>
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
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
                  </select>
                </label>
                <label>
                  <span>4 · Consultation mode</span>
                  <select name="consultation_mode" defaultValue="in_person">
                    <option value="in_person">In person</option>
                    <option value="online">Online</option>
                  </select>
                </label>
                <label>
                  <span>5 · Location or meeting platform</span>
                  <input
                    name="location"
                    required
                    placeholder="CLIRDEC room or approved online platform"
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
          <form className="knowledge-form" onSubmit={saveProfile}>
            <label>
              Expertise categories
              <input
                name="expertise"
                defaultValue={profile.expertise.join(", ")}
                placeholder="Software Engineering, Web Development"
                required
                maxLength={960}
              />
              <small>Separate categories with commas. Add only verified areas.</small>
            </label>
            <div className="profile-expertise-preview" aria-label="Current expertise">
              {profile.expertise.map((item) => (
                <span key={item}>{item}</span>
              ))}
              {!profile.expertise.length && <small>No expertise added yet.</small>}
            </div>
            <label>
              Faculty introduction
              <textarea
                name="bio"
                defaultValue={profile.bio}
                placeholder="Briefly describe your background and the consultation concerns you can support."
                rows={6}
                maxLength={2000}
              />
              <small>Students see this before requesting a consultation.</small>
            </label>
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
  filter,
  setFilter,
  decide,
  complete,
}: {
  requests: FacultyRequest[];
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
            {request.status === "confirmed" && (
              <div className="request-actions">
                <button
                  className="primary"
                  disabled={new Date(request.ends_at) > new Date()}
                  onClick={() => void complete(request.id)}
                >
                  Mark completed
                </button>
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

function AdminPages({ view, user }: { view: AView; user: User }) {
  const [data, setData] = useState<AdminPortal>({
    users: [],
    appointments: [],
    faqs: [],
    reviews: [],
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [appointmentFilter, setAppointmentFilter] = useState<
    "all" | AppointmentStatus
  >("all");
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  const [faqDraft, setFaqDraft] = useState({
    question: "",
    source: "",
    answer: "",
    category: "Consultation procedure",
    trainingPhrases: "",
  });
  const [trainingQuestion, setTrainingQuestion] = useState("");
  const [trainingReply, setTrainingReply] = useState<ChatbotReply | null>(null);
  const [trainingTestLoading, setTrainingTestLoading] = useState(false);
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
        });
      } else {
        await createFaqEntry({
          userId: user.id,
          question: faqDraft.question,
          answer: faqDraft.answer,
          sourceReference: faqDraft.source,
          category: faqDraft.category,
          trainingPhrases,
        });
      }
      setFaqDraft({
        question: "",
        source: "",
        answer: "",
        category: "Consultation procedure",
        trainingPhrases: "",
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
    });
  };
  const testTraining = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const question = trainingQuestion.trim();
    if (!question) return;
    setTrainingTestLoading(true);
    setTrainingReply(null);
    try {
      setTrainingReply(await requestChatbotReply(question));
    } catch {
      setMessage(
        "The chatbot test service is unavailable. Confirm the FastAPI deployment and VITE_CHATBOT_URL.",
      );
    } finally {
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
      <div className="empty-card">Loading the administration workspace…</div>
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
    (item.full_name + " " + item.department + " " + item.role)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const filteredAppointments =
    appointmentFilter === "all"
      ? data.appointments
      : data.appointments.filter((item) => item.status === appointmentFilter);
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
        <Data headings={["User", "Department", "Role", "Status", "Action"]}>
          {filteredUsers.map((item) => (
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
                <i className="active-pill">Active</i>
              </span>
              <span data-label="Action">
                <small>
                  {item.id === user.id ? "Current account" : "Audited change"}
                </small>
              </span>
            </div>
          ))}
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
          label="CONTROLLED NLP WORKSPACE"
          title="Train the consultation chatbot"
          copy="Improve how the spaCy assistant understands student questions while keeping every answer tied to an approved CLSU source."
        />
        <Stats
          data={[
            [
              String(data.faqs.filter((faq) => faq.status === "approved").length),
              "Live answers",
            ],
            [
              String(
                data.faqs.filter(
                  (faq) => faq.status === "draft" || faq.status === "review",
                ).length,
              ),
              "Awaiting approval",
            ],
            [
              String(
                data.faqs.reduce(
                  (total, faq) => total + (faq.training_phrases?.length || 0),
                  0,
                ),
              ),
              "Example phrases",
            ],
            [
              String(new Set(data.faqs.map((faq) => faq.category)).size),
              "Covered categories",
            ],
          ]}
        />
        <div className="training-workflow" aria-label="Chatbot training workflow">
          <div><b>1</b><span><strong>Draft</strong><small>Add an answer and realistic student phrases.</small></span></div>
          <div><b>2</b><span><strong>Verify</strong><small>Check the official source and wording.</small></span></div>
          <div><b>3</b><span><strong>Approve</strong><small>Publish the entry to the chatbot.</small></span></div>
          <div><b>4</b><span><strong>Test</strong><small>Confirm the live response and confidence.</small></span></div>
        </div>
        <div className="knowledge-layout chatbot-training-layout">
          <Work title={editingFaqId ? "Edit training entry" : "Add training entry"}>
            <form className="knowledge-form" onSubmit={saveFaq}>
              <label>
                Canonical student question
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
                <small>Write the clearest version of the question.</small>
              </label>
              <label>
                Official source reference
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
                <small>Answers without a verifiable source must not be approved.</small>
              </label>
              <label>
                Approved answer
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
              </label>
              <label>
                Example student phrases
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
                Category
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
              </label>
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
          <Work title="Test the live chatbot">
            <div className="training-test-panel" aria-live="polite">
              <p>
                Test the same endpoint students use. Only approved entries are included;
                newly approved content can take up to five minutes to refresh.
              </p>
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
                  <button className="primary" disabled={trainingTestLoading}>
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
                  <b>Test before pilot sessions</b>
                  <span>Try common wording, abbreviations, and Filipino phrases.</span>
                </div>
              )}
            </div>
          </Work>
        </div>
        <Work title="Training library and approval queue">
          <div className="training-library-note">
            <span>Editing an approved entry returns it to draft so a second source check is required.</span>
            <b>{data.faqs.length} total entries</b>
          </div>
            <div className="faq-list">
              {data.faqs.map((faq: FaqEntry) => (
                <article key={faq.id}>
                  <span className={`faq-status ${faq.status}`}>{faq.status}</span>
                  <div className="faq-copy">
                    <b>{faq.question}</b>
                    <small>{faq.category} · {faq.source_reference}</small>
                    <p>{faq.answer}</p>
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
              {!data.faqs.length && (
                <div className="empty-card">
                  No training entries yet. Add a source-backed answer to begin.
                </div>
              )}
            </div>
        </Work>
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
            [String(data.reviews.length), "Submitted reviews"],
            [
              String(data.reviews.filter((review) => review.comment).length),
              "Written comments",
            ],
            [
              String(data.reviews.filter((review) => review.rating >= 4).length),
              "Positive ratings",
            ],
          ]}
        />
        <section className="review-breakdowns">
          <ReviewBreakdown title="By year level" rows={reviewGroups("year_level")} />
          <ReviewBreakdown title="By college or unit" rows={reviewGroups("college")} />
          <ReviewBreakdown title="By course or program" rows={reviewGroups("program")} />
        </section>
        <Work title="Written consultation feedback">
          <div className="admin-review-list">
            {data.reviews.map((review) => {
              const appointment = appointmentById.get(review.appointment_id);
              return (
                <article key={review.id}>
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
            {!data.reviews.length && (
              <div className="empty-card">
                No completed-consultation reviews have been submitted yet.
              </div>
            )}
          </div>
        </Work>
      </>
    );
  return (
    <>
      {feedback}
      <Head
        label="MISO ADMINISTRATION"
        title="QA and user-acceptance testing"
        copy="Track provisional thresholds that still require Product Owner confirmation."
        action="Export QA evidence"
      />
      <Stats
        data={[
          ["80%", "FAQ accuracy target"],
          ["≤3s", "Response-time target"],
          ["80%", "Task completion target"],
          ["4/5", "Satisfaction target"],
        ]}
      />
      <div className="report-grid">
        <Work title="Required service checks">
          <div className="qa-list">
            <p>
              <b>FAQ test set</b>
              <span>
                Approved questions, supported paraphrases, and official source
                traceability.
              </span>
            </p>
            <p>
              <b>Safe fallback</b>
              <span>
                Clarification, suggested topics, and staff referral for
                unsupported questions.
              </span>
            </p>
            <p>
              <b>Role separation</b>
              <span>
                Student, faculty, and administrator permissions remain distinct.
              </span>
            </p>
            <p>
              <b>Availability integrity</b>
              <span>
                Only faculty-approved schedules are shown; no invented confirmed
                booking.
              </span>
            </p>
          </div>
        </Work>
        <Work title="Acceptance gate">
          <div className="qa-list">
            <p>
              <b>No critical security or privacy defect</b>
              <i>Required</i>
            </p>
            <p>
              <b>No unresolved high-severity error</b>
              <i>Required</i>
            </p>
            <p>
              <b>Representative students and faculty tested</b>
              <i>Pending</i>
            </p>
            <p>
              <b>Product Owner threshold confirmation</b>
              <i>Open question</i>
            </p>
          </div>
        </Work>
      </div>
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
