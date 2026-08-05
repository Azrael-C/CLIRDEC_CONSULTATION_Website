import { supabase } from "./supabase";

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "declined";

export type FacultyRequest = {
  id: string;
  availability_id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  topic: string;
  notes: string;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  location: string;
  consultation_mode: "in_person" | "online";
};

export type FacultyAvailability = {
  id: string;
  starts_at: string;
  ends_at: string;
  location: string;
  consultation_mode: "in_person" | "online";
  is_open: boolean;
};

function message(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export async function loadFacultyPortal(facultyId: string) {
  const { data: availability, error: availabilityError } = await supabase
    .from("availability")
    .select("id,starts_at,ends_at,location,consultation_mode,is_open")
    .eq("faculty_id", facultyId)
    .order("starts_at", { ascending: true });
  if (availabilityError) throw new Error(message(availabilityError, "Faculty availability could not be loaded."));

  const slots = (availability || []) as FacultyAvailability[];
  const slotIds = slots.map((slot) => slot.id);
  if (!slotIds.length) return { requests: [] as FacultyRequest[], availability: slots };

  const { data: appointments, error: appointmentError } = await supabase
    .from("appointments")
    .select("id,availability_id,student_id,topic,notes,status,created_at")
    .in("availability_id", slotIds)
    .order("created_at", { ascending: false });
  if (appointmentError) throw new Error(message(appointmentError, "Consultation requests could not be loaded."));

  const studentIds = [...new Set((appointments || []).map((item) => item.student_id))];
  const { data: students, error: studentError } = studentIds.length
    ? await supabase.from("profiles").select("id,full_name").in("id", studentIds)
    : { data: [], error: null };
  if (studentError) throw new Error(message(studentError, "Student profiles could not be loaded."));

  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const studentById = new Map((students || []).map((student) => [student.id, student]));
  const requests = (appointments || []).map((item) => {
    const slot = slotById.get(item.availability_id);
    const student = studentById.get(item.student_id);
    return {
      id: item.id,
      availability_id: item.availability_id,
      student_id: item.student_id,
      student_name: student?.full_name || "Student",
      student_email: "",
      topic: item.topic,
      notes: item.notes || "No additional note was provided.",
      status: item.status as AppointmentStatus,
      starts_at: slot?.starts_at || "",
      ends_at: slot?.ends_at || "",
      location: slot?.location || "Location to be confirmed",
      consultation_mode: slot?.consultation_mode || "in_person",
    } satisfies FacultyRequest;
  });

  return { requests, availability: slots };
}

export async function decideFacultyRequest(requestId: string, status: "confirmed" | "declined") {
  const { error } = await supabase.from("appointments").update({ status }).eq("id", requestId);
  if (error) throw new Error(message(error, "The consultation decision could not be saved."));
}

export async function createFacultyAvailability(input: {
  facultyId: string;
  startsAt: string;
  endsAt: string;
  location: string;
  consultationMode: "in_person" | "online";
}) {
  const { data, error } = await supabase
    .from("availability")
    .insert({
      faculty_id: input.facultyId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      location: input.location,
      consultation_mode: input.consultationMode,
      is_open: true,
    })
    .select("id,starts_at,ends_at,location,consultation_mode,is_open")
    .single();
  if (error) throw new Error(message(error, "The availability entry could not be published."));
  return data as FacultyAvailability;
}

export async function removeFacultyAvailability(slotId: string) {
  const { error } = await supabase.from("availability").delete().eq("id", slotId).eq("is_open", true);
  if (error) throw new Error(message(error, "The availability entry could not be removed."));
}
