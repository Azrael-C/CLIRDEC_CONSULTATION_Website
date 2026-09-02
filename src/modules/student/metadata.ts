import type { View } from "../shared/types";

export const studentMetadata: Record<View, [string, string]> = {
  home: ["Student overview | CLSU FacultyConnect", "Access approved consultation guidance, requests, and faculty availability."],
  find: ["Faculty availability | CLSU FacultyConnect", "Browse faculty-published consultation schedules and expertise categories."],
  schedule: ["My consultation requests | CLSU FacultyConnect", "Review consultation request status, appointment details, and completed-session feedback."],
  assistant: ["Consult AI | CLSU FacultyConnect", "Ask questions using the approved CLSU consultation knowledge base."],
  profile: ["My profile | CLSU FacultyConnect", "Manage your FacultyConnect student profile and notification preferences."],
};
