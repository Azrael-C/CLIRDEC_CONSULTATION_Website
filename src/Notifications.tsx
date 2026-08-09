import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadAdminPortal,
  loadFacultyPortal,
  type AppointmentStatus,
  type PortalAppointment,
} from "./backend";
import { configured } from "./supabase";
import { formatManilaDateTime } from "./scheduling";

type PortalRole = "student" | "faculty" | "admin";

type NotificationUser = {
  id: string;
  role: PortalRole;
};

export type NotificationAppointment = Pick<
  PortalAppointment,
  "id" | "status" | "starts_at" | "faculty_name" | "student_name" | "topic" | "location"
>;

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  target: string;
  tone: "info" | "success" | "warning" | "danger";
};

const emptyAppointments: NotificationAppointment[] = [];

const studentTitles: Record<AppointmentStatus, string> = {
  pending: "Request awaiting faculty approval",
  confirmed: "Consultation confirmed",
  completed: "Consultation completed",
  cancelled: "Consultation cancelled",
  declined: "Consultation request declined",
};

const statusTones: Record<AppointmentStatus, NotificationItem["tone"]> = {
  pending: "warning",
  confirmed: "success",
  completed: "success",
  cancelled: "danger",
  declined: "danger",
};

function appointmentTime(startsAt: string) {
  return formatManilaDateTime(new Date(startsAt), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function studentNotifications(appointments: NotificationAppointment[]): NotificationItem[] {
  return appointments.map((appointment) => ({
    id: `student:${appointment.id}:${appointment.status}`,
    title: studentTitles[appointment.status],
    message: `${appointment.faculty_name || "Faculty member"} · ${appointmentTime(appointment.starts_at)}`,
    timestamp: appointment.starts_at,
    target: "schedule",
    tone: statusTones[appointment.status],
  }));
}

function facultyNotifications(appointments: PortalAppointment[]): NotificationItem[] {
  return appointments
    .filter((appointment) => appointment.status === "pending" || appointment.status === "confirmed")
    .map((appointment) => ({
      id: `faculty:${appointment.id}:${appointment.status}`,
      title: appointment.status === "pending" ? "New consultation request" : "Upcoming confirmed consultation",
      message: `${appointment.student_name} · ${appointment.topic} · ${appointmentTime(appointment.starts_at)}`,
      timestamp: appointment.starts_at,
      target: "requests",
      tone: appointment.status === "pending" ? "warning" : "success",
    }));
}

async function roleNotifications(user: NotificationUser): Promise<NotificationItem[]> {
  if (!configured) return [];
  if (user.role === "faculty") {
    const portal = await loadFacultyPortal(user.id);
    return facultyNotifications(portal.requests);
  }
  if (user.role === "admin") {
    const portal = await loadAdminPortal();
    const appointmentItems: NotificationItem[] = portal.appointments
      .filter((appointment) => appointment.status === "pending")
      .map((appointment) => ({
        id: `admin:appointment:${appointment.id}:${appointment.status}`,
        title: "Pending consultation request",
        message: `${appointment.student_name} with ${appointment.faculty_name} · ${appointmentTime(appointment.starts_at)}`,
        timestamp: appointment.starts_at,
        target: "appointments",
        tone: "warning",
      }));
    const faqItems: NotificationItem[] = portal.faqs
      .filter((faq) => faq.status === "draft" || faq.status === "review")
      .map((faq) => ({
        id: `admin:faq:${faq.id}:${faq.status}`,
        title: "FAQ entry awaiting approval",
        message: faq.question,
        timestamp: faq.updated_at,
        target: "knowledge",
        tone: "info",
      }));
    return [...faqItems, ...appointmentItems];
  }
  return [];
}

function BellIcon() {
  return <svg className="bell-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>
    <path d="M10 21h4"/>
  </svg>;
}

function relativeTime(value: string) {
  const date = new Date(value);
  const difference = date.getTime() - Date.now();
  const absolute = Math.abs(difference);
  if (absolute < 60_000) return "Just now";
  if (absolute < 3_600_000) return `${Math.max(1, Math.round(absolute / 60_000))}m ${difference < 0 ? "ago" : "from now"}`;
  if (absolute < 86_400_000) return `${Math.round(absolute / 3_600_000)}h ${difference < 0 ? "ago" : "from now"}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function NotificationCenter({
  user,
  studentAppointments = emptyAppointments,
  onNavigate,
}: {
  user: NotificationUser;
  studentAppointments?: NotificationAppointment[];
  onNavigate: (target: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(user.role !== "student");
  const [error, setError] = useState("");
  const [readIds, setReadIds] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const storageKey = `facultyconnect.notifications.read.${user.id}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setReadIds(Array.isArray(saved) ? saved : []);
    } catch {
      setReadIds([]);
    }
  }, [storageKey]);

  useEffect(() => {
    if (user.role === "student") {
      setItems(studentNotifications(studentAppointments));
      setLoading(false);
      return;
    }
    let active = true;
    const refresh = async () => {
      setLoading(true);
      try {
        const next = await roleNotifications(user);
        if (active) {
          setItems(next);
          setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Notifications could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("facultyconnect:refresh-notifications", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("facultyconnect:refresh-notifications", refresh);
    };
  }, [user.id, user.role, studentAppointments]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 12),
    [items],
  );
  const unreadCount = sortedItems.filter((item) => !readIds.includes(item.id)).length;

  const saveReadIds = (next: string[]) => {
    const compact = [...new Set(next)].slice(-100);
    setReadIds(compact);
    localStorage.setItem(storageKey, JSON.stringify(compact));
  };

  const openItem = (item: NotificationItem) => {
    saveReadIds([...readIds, item.id]);
    setOpen(false);
    onNavigate(item.target);
  };

  return <div className="notification-center" ref={rootRef}>
    <button
      type="button"
      className="icon-button notification-button"
      aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
      aria-expanded={open}
      aria-controls="portal-notifications"
      onClick={() => setOpen((value) => !value)}
    >
      <BellIcon/>
      {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
    </button>
    {open && <section id="portal-notifications" className="notification-panel" aria-label="Notifications">
      <header>
        <div><p>NOTIFICATIONS</p><h2>Recent updates</h2></div>
        {unreadCount > 0 && <button type="button" onClick={() => saveReadIds([...readIds, ...sortedItems.map((item) => item.id)])}>Mark all read</button>}
      </header>
      <div className="notification-list">
        {loading && <p className="notification-empty">Loading updates…</p>}
        {!loading && error && <p className="notification-empty notification-error">{error}</p>}
        {!loading && !error && !sortedItems.length && <p className="notification-empty">You’re all caught up. New appointment updates will appear here.</p>}
        {!loading && !error && sortedItems.map((item) => {
          const unread = !readIds.includes(item.id);
          return <button type="button" className={unread ? "notification-item unread" : "notification-item"} key={item.id} onClick={() => openItem(item)}>
            <span className={`notification-symbol ${item.tone}`}/>
            <span className="notification-copy"><b>{item.title}</b><small>{item.message}</small></span>
            <time dateTime={item.timestamp}>{relativeTime(item.timestamp)}</time>
          </button>;
        })}
      </div>
      <footer>Email updates remain enabled for appointment decisions and reminders.</footer>
    </section>}
  </div>;
}
