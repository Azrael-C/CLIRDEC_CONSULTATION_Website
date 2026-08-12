import { supabase } from "./supabase";
import { availabilityValidationMessage, MINIMUM_NOTICE_MS } from "./scheduling";

export type Role = "student" | "faculty" | "admin";
export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "declined";
export type ConsultationMode = "in_person" | "online";

export type FacultyAvailability = {
  id: string;
  faculty_id?: string;
  starts_at: string;
  ends_at: string;
  location: string;
  consultation_mode: ConsultationMode;
  is_open: boolean;
};

export type PortalSlot = FacultyAvailability & {
  faculty_name: string;
  expertise: string[];
};

export type PortalAppointment = {
  id: string;
  availability_id: string;
  student_id: string;
  student_name: string;
  student_email?: string;
  topic: string;
  notes: string;
  status: AppointmentStatus;
  updated_at: string;
  starts_at: string;
  ends_at: string;
  location: string;
  consultation_mode: ConsultationMode;
  faculty_id: string;
  faculty_name: string;
  expertise: string[];
  review?: ConsultationReview;
};

export type FacultyRequest = PortalAppointment;

export type FacultyProfile = {
  expertise: string[];
  bio: string;
  active: boolean;
};

export type AdminUser = {
  id: string;
  full_name: string;
  role: Role;
  department: string;
};

export type ConsultationReview = {
  id: string;
  appointment_id: string;
  student_id: string;
  faculty_id: string;
  rating: number;
  comment: string | null;
  year_level: string | null;
  college: string | null;
  program: string | null;
  created_at: string;
  updated_at: string;
};

export type RegistrationEmail = {
  email: string;
  active: boolean;
  created_at: string;
};

export type FaqStatus = "draft" | "review" | "approved" | "archived";
export type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  category: string;
  source_reference: string;
  status: FaqStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
};

export type AdminPortal = {
  users: AdminUser[];
  appointments: PortalAppointment[];
  faqs: FaqEntry[];
  registrationEmails: RegistrationEmail[];
  reviews: ConsultationReview[];
};

type DbError = { message?: string; code?: string; details?: string } | null;

function friendlyError(error: DbError, fallback: string) {
  const raw = error?.message || error?.details || fallback;
  if (/no longer available|duplicate key|one_active_appointment/i.test(raw)) {
    return "That consultation time was just taken. Refresh the schedule and choose another slot.";
  }
  if (/overlap|no_overlapping_faculty_slots/i.test(raw)) {
    return "That time overlaps an availability entry already on the faculty schedule.";
  }
  if (/24 hours/i.test(raw))
    return "Choose a consultation time at least 24 hours from now.";
  if (/row-level security|permission denied/i.test(raw)) {
    return "Your account is not allowed to perform that action.";
  }
  return raw;
}

function requireData<T>(data: T | null, error: DbError, fallback: string): T {
  if (error) throw new Error(friendlyError(error, fallback));
  if (data === null) throw new Error(fallback);
  return data;
}

function relation<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export { initials };

export async function loadStudentPortal(studentId: string) {
  const earliestBookable = new Date(
    Date.now() + MINIMUM_NOTICE_MS,
  ).toISOString();
  const [
    { data: open, error: slotError },
    { data: appointmentRows, error: appointmentError },
    { data: reviewRows, error: reviewError },
  ] = await Promise.all([
    supabase
      .from("availability")
      .select(
        "id,faculty_id,starts_at,ends_at,location,consultation_mode,is_open",
      )
      .eq("is_open", true)
      .gte("starts_at", earliestBookable)
      .order("starts_at"),
    supabase
      .from("appointments")
      .select(
        "id,availability_id,student_id,topic,notes,status,created_at,updated_at,availability:availability_id(id,faculty_id,starts_at,ends_at,location,consultation_mode,is_open)",
      )
      .eq("student_id", studentId)
      .order("created_at", { ascending: false }),
    supabase
      .from("consultation_reviews")
      .select("id,appointment_id,student_id,faculty_id,rating,comment,year_level,college,program,created_at,updated_at")
      .eq("student_id", studentId),
  ]);
  if (slotError)
    throw new Error(
      friendlyError(slotError, "Faculty availability could not be loaded."),
    );
  if (appointmentError)
    throw new Error(
      friendlyError(appointmentError, "Your requests could not be loaded."),
    );
  if (reviewError)
    throw new Error(
      friendlyError(reviewError, "Your consultation reviews could not be loaded."),
    );

  const reviews = new Map(
    ((reviewRows || []) as ConsultationReview[]).map((review) => [
      review.appointment_id,
      review,
    ]),
  );

  const facultyIds = [
    ...new Set(
      [
        ...(open || []).map((slot) => slot.faculty_id),
        ...(appointmentRows || []).map(
          (row) => relation<any>(row.availability)?.faculty_id,
        ),
      ].filter(Boolean),
    ),
  ] as string[];

  const { data: facultyDirectory, error: directoryError } = facultyIds.length
    ? await supabase.rpc("faculty_directory", { target_ids: facultyIds })
    : { data: [], error: null };
  if (directoryError) {
    throw new Error(
      friendlyError(directoryError, "Faculty profiles could not be loaded."),
    );
  }
  const directoryRows = (facultyDirectory || []) as Array<{
    id: string;
    full_name: string;
    expertise: string[];
  }>;
  const names = new Map(
    directoryRows.map((profile) => [profile.id, profile.full_name]),
  );
  const expertise = new Map(
    directoryRows.map((profile) => [profile.id, profile.expertise || []]),
  );
  const activeFaculty = new Set(directoryRows.map((profile) => profile.id));

  const slots: PortalSlot[] = (open || [])
    .filter((slot) => activeFaculty.has(slot.faculty_id))
    .map((slot) => ({
      ...slot,
      location: slot.location || "Location provided after approval",
      faculty_name: names.get(slot.faculty_id) || "Faculty member",
      expertise: expertise.get(slot.faculty_id) || [],
    }));

  const appointments: PortalAppointment[] = (appointmentRows || []).flatMap(
    (row) => {
      const slot = relation<any>(row.availability);
      if (!slot) return [];
      return [
        {
          id: row.id,
          availability_id: row.availability_id,
          student_id: row.student_id,
          student_name: "",
          topic: row.topic,
          notes: row.notes || "",
          status: row.status as AppointmentStatus,
          updated_at: row.updated_at || row.created_at,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          location: slot.location || "Location provided after approval",
          consultation_mode: slot.consultation_mode as ConsultationMode,
          faculty_id: slot.faculty_id,
          faculty_name: names.get(slot.faculty_id) || "Faculty member",
          expertise: expertise.get(slot.faculty_id) || [],
          review: reviews.get(row.id),
        },
      ];
    },
  );

  return { slots, appointments };
}

export async function submitConsultationReview(input: {
  appointmentId: string;
  rating: number;
  comment?: string;
}) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    throw new Error("Choose a rating from 1 to 5 stars.");
  if ((input.comment || "").trim().length > 1000)
    throw new Error("Review comments may contain at most 1000 characters.");
  const { data, error } = await supabase.rpc("submit_consultation_review", {
    target_appointment: input.appointmentId,
    review_rating: input.rating,
    review_comment: input.comment?.trim() || null,
  });
  return requireData(
    data as string | null,
    error,
    "Your consultation review could not be submitted.",
  );
}

export async function bookAppointment(input: {
  slotId: string;
  topic: string;
  notes?: string;
}) {
  const topic = input.topic.trim();
  if (topic.length < 5)
    throw new Error(
      "Describe your consultation concern in at least 5 characters.",
    );
  const { data, error } = await supabase.rpc("book_consultation", {
    target_availability: input.slotId,
    consultation_topic: topic,
    consultation_notes: input.notes?.trim() || topic,
  });
  return requireData(
    data as string | null,
    error,
    "The consultation request could not be submitted.",
  );
}

export async function cancelAppointment(appointmentId: string) {
  const { error } = await supabase.rpc("cancel_consultation", {
    target_appointment: appointmentId,
  });
  if (error)
    throw new Error(
      friendlyError(error, "The consultation could not be cancelled."),
    );
}

export async function rescheduleAppointment(
  appointmentId: string,
  newSlotId: string,
) {
  const { data, error } = await supabase.rpc("reschedule_consultation", {
    target_appointment: appointmentId,
    new_availability: newSlotId,
  });
  return requireData(
    data as string | null,
    error,
    "The consultation could not be rescheduled.",
  );
}

export async function loadFacultyPortal(facultyId: string) {
  const { data: availability, error: availabilityError } = await supabase
    .from("availability")
    .select(
      "id,faculty_id,starts_at,ends_at,location,consultation_mode,is_open",
    )
    .eq("faculty_id", facultyId)
    .order("starts_at", { ascending: true });
  if (availabilityError)
    throw new Error(
      friendlyError(
        availabilityError,
        "Faculty availability could not be loaded.",
      ),
    );

  const slots = (availability || []) as FacultyAvailability[];
  const slotIds = slots.map((slot) => slot.id);
  if (!slotIds.length)
    return { requests: [] as FacultyRequest[], availability: slots };

  const { data: appointments, error: appointmentError } = await supabase
    .from("appointments")
    .select(
      "id,availability_id,student_id,topic,notes,status,created_at,updated_at",
    )
    .in("availability_id", slotIds)
    .order("created_at", { ascending: false });
  if (appointmentError)
    throw new Error(
      friendlyError(
        appointmentError,
        "Consultation requests could not be loaded.",
      ),
    );

  const studentIds = [
    ...new Set((appointments || []).map((item) => item.student_id)),
  ];
  const { data: students, error: studentError } = studentIds.length
    ? await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", studentIds)
    : { data: [], error: null };
  if (studentError)
    throw new Error(
      friendlyError(studentError, "Student profiles could not be loaded."),
    );

  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const studentById = new Map(
    (students || []).map((student) => [student.id, student]),
  );
  const requests = (appointments || []).flatMap((item) => {
    const slot = slotById.get(item.availability_id);
    if (!slot) return [];
    const student = studentById.get(item.student_id);
    return [
      {
        id: item.id,
        availability_id: item.availability_id,
        student_id: item.student_id,
        student_name: student?.full_name || "Student",
        topic: item.topic,
        notes: item.notes || "No additional note was provided.",
        status: item.status as AppointmentStatus,
        updated_at: item.updated_at || item.created_at,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        location: slot.location || "Location to be confirmed",
        consultation_mode: slot.consultation_mode,
        faculty_id: facultyId,
        faculty_name: "",
        expertise: [],
      },
    ];
  });

  return { requests, availability: slots };
}

export async function decideFacultyRequest(
  requestId: string,
  status: "confirmed" | "declined",
) {
  const { error } = await supabase.rpc("decide_consultation", {
    target_appointment: requestId,
    decision: status,
  });
  if (error)
    throw new Error(
      friendlyError(error, "The consultation decision could not be saved."),
    );
}

export async function completeFacultyRequest(requestId: string) {
  const { error } = await supabase.rpc("complete_consultation", {
    target_appointment: requestId,
  });
  if (error)
    throw new Error(
      friendlyError(error, "The consultation could not be marked completed."),
    );
}

export async function createFacultyAvailability(input: {
  facultyId: string;
  startsAt: string;
  endsAt: string;
  location: string;
  consultationMode: ConsultationMode;
}) {
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  const validation = availabilityValidationMessage(start, end, []);
  if (validation) throw new Error(validation);
  if (input.location.trim().length < 3)
    throw new Error(
      "Provide the consultation room or approved online platform.",
    );

  const { data, error } = await supabase
    .from("availability")
    .insert({
      faculty_id: input.facultyId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      location: input.location.trim(),
      consultation_mode: input.consultationMode,
      is_open: true,
    })
    .select(
      "id,faculty_id,starts_at,ends_at,location,consultation_mode,is_open",
    )
    .single();
  return requireData(
    data as FacultyAvailability | null,
    error,
    "The availability entry could not be published.",
  );
}

export async function removeFacultyAvailability(slotId: string) {
  const { error } = await supabase.rpc("withdraw_availability", {
    target_availability: slotId,
  });
  if (error)
    throw new Error(
      friendlyError(error, "The availability entry could not be withdrawn."),
    );
}

export async function updateFacultyProfile(input: {
  userId: string;
  expertise: string[];
  bio: string;
}) {
  const expertise = input.expertise
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!expertise.length)
    throw new Error("Add at least one faculty expertise category.");
  const { error } = await supabase
    .from("faculty_profiles")
    .update({ expertise, bio: input.bio.trim() })
    .eq("user_id", input.userId);
  if (error)
    throw new Error(
      friendlyError(error, "The faculty profile could not be updated."),
    );
}

export async function loadFacultyProfile(
  userId: string,
): Promise<FacultyProfile> {
  const { data, error } = await supabase
    .from("faculty_profiles")
    .select("expertise,bio,active")
    .eq("user_id", userId)
    .single();
  return requireData(
    {
      expertise: data?.expertise || [],
      bio: data?.bio || "",
      active: data?.active ?? true,
    },
    error,
    "The faculty profile could not be loaded.",
  );
}

export async function loadAdminPortal(): Promise<AdminPortal> {
  const [
    { data: users, error: userError },
    { data: rows, error: appointmentError },
    { data: faqs, error: faqError },
    { data: registrationEmails, error: registrationError },
    { data: reviews, error: reviewError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,full_name,role,department")
      .order("full_name"),
    supabase
      .from("appointments")
      .select(
        "id,availability_id,student_id,topic,notes,status,created_at,updated_at,availability:availability_id(id,faculty_id,starts_at,ends_at,location,consultation_mode,is_open)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("faq_entries")
      .select(
        "id,question,answer,category,source_reference,status,created_by,approved_by,approved_at,updated_at",
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("registration_allowlist")
      .select("email,active,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("consultation_reviews")
      .select("id,appointment_id,student_id,faculty_id,rating,comment,year_level,college,program,created_at,updated_at")
      .order("created_at", { ascending: false }),
  ]);
  if (userError || appointmentError || faqError || registrationError || reviewError) {
    throw new Error(
      friendlyError(
        userError || appointmentError || faqError || registrationError || reviewError,
        "The administration workspace could not be loaded.",
      ),
    );
  }

  const profileMap = new Map(
    (users || []).map((profile) => [profile.id, profile.full_name]),
  );
  const appointments: PortalAppointment[] = (rows || []).flatMap((row) => {
    const slot = relation<any>(row.availability);
    if (!slot) return [];
    return [
      {
        id: row.id,
        availability_id: row.availability_id,
        student_id: row.student_id,
        student_name: profileMap.get(row.student_id) || "Student",
        topic: row.topic,
        notes: row.notes || "",
        status: row.status as AppointmentStatus,
        updated_at: row.updated_at || row.created_at,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        location: slot.location || "Location to be confirmed",
        consultation_mode: slot.consultation_mode as ConsultationMode,
        faculty_id: slot.faculty_id,
        faculty_name: profileMap.get(slot.faculty_id) || "Faculty member",
        expertise: [],
      },
    ];
  });

  return {
    users: (users || []).map((profile) => ({
      ...profile,
      role: profile.role as Role,
      department: profile.department || "",
    })),
    appointments,
    faqs: (faqs || []) as FaqEntry[],
    registrationEmails: (registrationEmails || []) as RegistrationEmail[],
    reviews: (reviews || []) as ConsultationReview[],
  };
}

export async function approveRegistrationEmail(
  email: string,
  administratorId: string,
) {
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized))
    throw new Error("Enter a valid participant email address.");
  const { error } = await supabase.from("registration_allowlist").upsert(
    {
      email: normalized,
      active: true,
      added_by: administratorId,
    },
    { onConflict: "email" },
  );
  if (error)
    throw new Error(
      friendlyError(error, "The registration email could not be approved."),
    );
}

export async function deactivateRegistrationEmail(email: string) {
  const { error } = await supabase
    .from("registration_allowlist")
    .update({ active: false })
    .eq("email", email.trim().toLowerCase());
  if (error)
    throw new Error(
      friendlyError(error, "The registration approval could not be removed."),
    );
}

export async function adminSetRole(userId: string, role: Role) {
  const { error } = await supabase.rpc("admin_set_user_role", {
    target_user: userId,
    new_role: role,
  });
  if (error)
    throw new Error(
      friendlyError(error, "The user role could not be updated."),
    );
}

export async function createFaqEntry(input: {
  userId: string;
  question: string;
  answer: string;
  category: string;
  sourceReference: string;
}) {
  if (input.question.trim().length < 8 || input.answer.trim().length < 15) {
    throw new Error("Provide a complete question and a clear approved answer.");
  }
  if (input.sourceReference.trim().length < 5)
    throw new Error("Identify the official source for this answer.");
  const { error } = await supabase.from("faq_entries").insert({
    question: input.question.trim(),
    answer: input.answer.trim(),
    category: input.category.trim(),
    source_reference: input.sourceReference.trim(),
    status: "draft",
    created_by: input.userId,
  });
  if (error)
    throw new Error(friendlyError(error, "The FAQ draft could not be saved."));
}

export async function approveFaqEntry(faqId: string, approverId: string) {
  const { error } = await supabase
    .from("faq_entries")
    .update({
      status: "approved",
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", faqId);
  if (error)
    throw new Error(
      friendlyError(error, "The FAQ entry could not be approved."),
    );
}

export async function archiveFaqEntry(faqId: string) {
  const { error } = await supabase
    .from("faq_entries")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", faqId);
  if (error)
    throw new Error(
      friendlyError(error, "The FAQ entry could not be archived."),
    );
}
