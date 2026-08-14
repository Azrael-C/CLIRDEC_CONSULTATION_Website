import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";

const required = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "TEST_STUDENT_EMAIL",
  "TEST_FACULTY_EMAIL",
  "TEST_ADMIN_EMAIL",
  "TEST_USER_PASSWORD",
];

if (process.env.ALLOW_TEST_SEED !== "true") {
  throw new Error("Refusing to seed. Set ALLOW_TEST_SEED=true for a dedicated test or pilot project.");
}

const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required environment keys: ${missing.join(", ")}`);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function findUser(email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 100) break;
  }
  return null;
}

async function ensureUser(email, fullName) {
  const existing = await findUser(email);
  if (existing) {
    const { data: factorData, error: factorListError } =
      await supabase.auth.admin.mfa.listFactors({ userId: existing.id });
    if (factorListError) throw factorListError;
    for (const factor of factorData?.factors || []) {
      const { error: factorDeleteError } =
        await supabase.auth.admin.mfa.deleteFactor({
          userId: existing.id,
          id: factor.id,
        });
      if (factorDeleteError) throw factorDeleteError;
    }
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      email,
      password: process.env.TEST_USER_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    return data.user;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: process.env.TEST_USER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user;
}

async function configureMfa(email) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({
    email,
    password: process.env.TEST_USER_PASSWORD,
  });
  if (loginError) throw loginError;
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "FacultyConnect E2E",
  });
  if (error || !data) throw error || new Error(`Could not enroll MFA for ${email}`);
  const totp = new OTPAuth.TOTP({
    issuer: "CLSU FacultyConnect",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: data.totp.secret,
  });
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: totp.generate(),
  });
  if (verifyError) throw verifyError;
  await client.auth.signOut({ scope: "local" });
  return data.totp.secret;
}

const accounts = [
  { key: "student", email: process.env.TEST_STUDENT_EMAIL, name: "Test Student", role: "student", department: "College of Engineering" },
  { key: "faculty", email: process.env.TEST_FACULTY_EMAIL, name: "Dr. Test Faculty", role: "faculty", department: "CLIRDEC" },
  { key: "admin", email: process.env.TEST_ADMIN_EMAIL, name: "Test MISO Administrator", role: "admin", department: "MISO" },
];

for (const account of accounts) {
  if (!account.email.toLowerCase().includes("facultyconnect-e2e")) {
    throw new Error(
      `${account.key} email must be a dedicated test address containing facultyconnect-e2e.`,
    );
  }
}

const users = {};
for (const account of accounts) {
  const user = await ensureUser(account.email, account.name);
  users[account.key] = user;
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    full_name: account.name,
    email: account.email,
    role: account.role,
    department: account.department,
    email_notifications: true,
  });
  if (error) throw error;
}

const mfaSecrets = {};
for (const account of accounts.filter((item) => item.role !== "student")) {
  mfaSecrets[account.email] = await configureMfa(account.email);
}
await writeFile(".e2e-mfa.json", JSON.stringify(mfaSecrets), { encoding: "utf8", mode: 0o600 });

const { error: facultyError } = await supabase.from("faculty_profiles").upsert({
  user_id: users.faculty.id,
  expertise: ["Software Engineering", "Systems Analysis", "Web Development"],
  bio: "Test faculty profile for the controlled CLIRDEC pilot.",
  active: true,
});
if (facultyError) throw facultyError;

// Reset only records owned by the dedicated test identities. This keeps each
// lifecycle deterministic without touching genuine pilot records.
const { data: oldSlots, error: oldSlotError } = await supabase
  .from("availability")
  .select("id")
  .eq("faculty_id", users.faculty.id);
if (oldSlotError) throw oldSlotError;
const oldSlotIds = (oldSlots || []).map((slot) => slot.id);
const { data: oldAppointments, error: oldAppointmentError } = oldSlotIds.length
  ? await supabase
    .from("appointments")
    .select("id")
    .or(`student_id.eq.${users.student.id},availability_id.in.(${oldSlotIds.join(",")})`)
  : await supabase
    .from("appointments")
    .select("id")
    .eq("student_id", users.student.id);
if (oldAppointmentError) throw oldAppointmentError;
const oldAppointmentIds = (oldAppointments || []).map((appointment) => appointment.id);
if (oldAppointmentIds.length) {
  const { error: reviewDeleteError } = await supabase
    .from("consultation_reviews")
    .delete()
    .in("appointment_id", oldAppointmentIds);
  if (reviewDeleteError) throw reviewDeleteError;
  const { error: appointmentDeleteError } = await supabase
    .from("appointments")
    .delete()
    .in("id", oldAppointmentIds);
  if (appointmentDeleteError) throw appointmentDeleteError;
}
if (oldSlotIds.length) {
  const { error: slotDeleteError } = await supabase
    .from("availability")
    .delete()
    .in("id", oldSlotIds);
  if (slotDeleteError) throw slotDeleteError;
}
const { error: notificationDeleteError } = await supabase
  .from("email_notifications")
  .delete()
  .in("recipient_id", Object.values(users).map((user) => user.id));
if (notificationDeleteError) throw notificationDeleteError;

const now = new Date();
const daysUntilMonday = ((8 - now.getUTCDay()) % 7) || 7;
const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 1, 0, 0));
const slots = [0, 1, 3].map((dayOffset, index) => {
  const starts = new Date(firstDay);
  starts.setUTCDate(starts.getUTCDate() + dayOffset);
  starts.setUTCHours(1 + index * 2);
  const ends = new Date(starts.getTime() + 30 * 60 * 1000);
  return {
    faculty_id: users.faculty.id,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    location: "CLIRDEC Consultation Room",
    consultation_mode: "in_person",
    is_open: true,
  };
});

const { data: availability, error: availabilityError } = await supabase
  .from("availability")
  .upsert(slots, { onConflict: "faculty_id,starts_at,ends_at" })
  .select("id,starts_at");
if (availabilityError) throw availabilityError;

console.log(JSON.stringify({
  created: { users: accounts.length, availability: availability.length, appointments: 0 },
  accounts: accounts.map(({ key, email, role }) => ({ key, email, role })),
  note: "Passwords were read from TEST_USER_PASSWORD and were not printed. The browser test creates the appointment.",
}, null, 2));
