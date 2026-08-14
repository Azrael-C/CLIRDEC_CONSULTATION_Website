export type CalendarAppointment = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  status?: "CONFIRMED" | "CANCELLED";
};

function compactUtc(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function calendarFile(appointment: CalendarAppointment) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CLSU//FacultyConnect//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${appointment.status === "CANCELLED" ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${escapeIcs(appointment.id)}@clsufacultyconnect.com`,
    `DTSTAMP:${compactUtc(new Date().toISOString())}`,
    `DTSTART:${compactUtc(appointment.startsAt)}`,
    `DTEND:${compactUtc(appointment.endsAt)}`,
    `SUMMARY:${escapeIcs(appointment.title)}`,
    `DESCRIPTION:${escapeIcs(appointment.description)}`,
    `LOCATION:${escapeIcs(appointment.location)}`,
    `STATUS:${appointment.status || "CONFIRMED"}`,
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadCalendarFile(appointment: CalendarAppointment) {
  const blob = new Blob([calendarFile(appointment)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `faculty-consultation-${appointment.id.slice(0, 8)}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function googleCalendarUrl(appointment: CalendarAppointment) {
  const parameters = new URLSearchParams({
    action: "TEMPLATE",
    text: appointment.title,
    dates: `${compactUtc(appointment.startsAt)}/${compactUtc(appointment.endsAt)}`,
    details: appointment.description,
    location: appointment.location,
  });
  return `https://calendar.google.com/calendar/render?${parameters.toString()}`;
}

export function appointmentCalendarDetails(input: {
  id: string;
  facultyName: string;
  topic: string;
  startsAt: string;
  endsAt: string;
  location: string;
  status?: "confirmed" | "cancelled";
}): CalendarAppointment {
  return {
    id: input.id,
    title: `Faculty consultation: ${input.topic}`,
    description: `Confirmed CLSU FacultyConnect consultation with ${input.facultyName}. Open FacultyConnect for the latest status before attending.`,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    location: input.location,
    status: input.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
  };
}
