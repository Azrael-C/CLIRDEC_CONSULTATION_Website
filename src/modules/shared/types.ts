import type {
  AppointmentStatus,
  ConsultationReview,
} from "../../backend";

export type Role = "student" | "faculty" | "admin";
export type View = "home" | "find" | "schedule" | "assistant" | "profile";

export type User = {
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

export type Slot = {
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

export type ChatMessage = {
  who: "you" | "bot";
  text: string;
  source?: string;
  escalation?: boolean;
  suggestions?: string[];
};

export type ChatbotReply = {
  answer: string;
  intent: string;
  confidence: number;
  escalation: boolean;
  source?: string;
  suggestions?: string[];
};
