import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";

/*
 * Creates five clearly marked faculty identities and future availability for
 * controlled live testing. This is intentionally not part of the normal test
 * seeder: it requires two explicit confirmations and only accepts the linked
 * FacultyConnect project ref.
 */

const projectRef = "ieuipychazciovjhkpps";
const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required environment keys: ${missing.join(", ")}`);
if (process.env.ALLOW_LIVE_FACULTY_TEST_SEED !== "true") {
  throw new Error("Refusing live test seeding. Set ALLOW_LIVE_FACULTY_TEST_SEED=true.");
}
if (process.env.CONFIRM_LIVE_TEST_DATA !== "CREATE_FIVE_FACULTY_TEST_ACCOUNTS") {
  throw new Error("Refusing live test seeding. Set CONFIRM_LIVE_TEST_DATA=CREATE_FIVE_FACULTY_TEST_ACCOUNTS.");
}
if (!process.env.SUPABASE_URL.includes(projectRef)) {
  throw new Error(`Refusing to seed an unexpected Supabase project. Expected project ref ${projectRef}.`);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const names = [
  {
    name: "E2E Faculty 01 — Software Engineering",
    expertise: ["Software Engineering", "Systems Analysis"],
    subjects: ["Web Systems", "Software Design"],
    topics: ["System architecture", "Capstone planning"],
    research: ["Educational technology"],
  },
  {
    name: "E2E Faculty 02 — Data Management",
    expertise: ["Database Systems", "Data Management"],
    subjects: ["Database Management", "Data Warehousing"],
    topics: ["Schema design", "SQL optimization"],
    research: ["Data quality"],
  },
  {
    name: "E2E Faculty 03 — Research Methods",
    expertise: ["Research Methods", "Capstone Advising"],
    subjects: ["Thesis Writing", "Research Methods"],
    topics: ["Proposal review", "Methodology"],
    research: ["Learning analytics"],
  },
  {
    name: "E2E Faculty 04 — AI and NLP",
    expertise: ["Artificial Intelligence", "Natural Language Processing"],
    subjects: ["Machine Learning", "Natural Language Processing"],
    topics: ["Model evaluation", "Responsible AI"],
    research: ["Human-centered AI"],
  },
  {
    name: "E2E Faculty 05 — Cybersecurity",
    expertise: ["Cybersecurity", "Computer Networks"],
    subjects: ["Network Security", "Secure Web Development"],
    topics: ["Threat modeling", "Application security"],
    research: ["Privacy engineering"],
  },
];

const domain = process.env.FACULTY_TEST_EMAIL_DOMAIN || "clsu2.edu.ph";
const suppliedEmails = (process.env.FACULTY_TEST_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
if (suppliedEmails.length && suppliedEmails.length !== names.length) {
  throw new Error("FACULTY_TEST_EMAILS must contain exactly five comma-separated addresses.");
}
const emails = names.map((_, index) => suppliedEmails[index] || `facultyconnect-e2e-faculty-0${index + 1}@${domain}`);
if (emails.some((email) => !email.includes("facultyconnect-e2e"))) {
  throw new Error("Every live test address must contain facultyconnect-e2e.");
}

function makePassword() {
  return `FctE2E!${randomBytes(18).toString("base64url")}`;
}

const password = process.env.FACULTY_TEST_PASSWORD || makePassword();
const credentialFile = process.env.FACULTY_TEST_CREDENTIAL_FILE || ".faculty-live-test-credentials.json";
const mfaFile = process.env.FACULTY_TEST_MFA_FILE || ".faculty-live-test-mfa.json";

async function findUser(email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

async function ensureUser(email, displayName) {
  const existing = await findUser(email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName, live_test_identity: true },
    });
    if (error) throw error;
    return data.user;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName, live_test_identity: true },
  });
  if (error) throw error;
  return data.user;
}

async function configureMfa(email) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password });
  if (loginError) throw loginError;
  const { data: existing, error: listError } = await client.auth.mfa.listFactors();
  if (listError) throw listError;
  for (const factor of existing?.factors || []) {
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw error;
  }
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "CLSU FacultyConnect live test",
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

function nextMondayAtManila(hour, minute = 0) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const base = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const weekday = base.getUTCDay();
  const daysUntilMonday = weekday === 0 ? 1 : 8 - weekday;
  base.setUTCDate(base.getUTCDate() + daysUntilMonday);
  // Philippine Standard Time is UTC+8.
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour - 8, minute));
}

const accounts = [];
const mfaSecrets = {};
for (let index = 0; index < names.length; index += 1) {
  const profile = names[index];
  const email = emails[index];
  const user = await ensureUser(email, profile.name);
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: user.id,
    full_name: profile.name,
    email,
    role: "faculty",
    department: "CLIRDEC · LIVE TEST",
    email_notifications: true,
    account_status: "active",
  });
  if (profileError) throw profileError;
  const { error: facultyError } = await supabase.from("faculty_profiles").upsert({
    user_id: user.id,
    expertise: profile.expertise,
    subjects: profile.subjects,
    consultation_topics: profile.topics,
    research_interests: profile.research,
    bio: "Dedicated FacultyConnect live-test profile. Remove after the controlled test window.",
    office_location: "CLIRDEC · LIVE TEST",
    profile_completed_at: new Date().toISOString(),
    active: true,
  });
  if (facultyError) throw facultyError;

  // Remove only previous schedules owned by this clearly marked test identity.
  const { data: oldSlots, error: oldSlotError } = await supabase.from("availability").select("id").eq("faculty_id", user.id);
  if (oldSlotError) throw oldSlotError;
  const oldSlotIds = (oldSlots || []).map((slot) => slot.id);
  if (oldSlotIds.length) {
    const { error: oldAppointmentsError } = await supabase.from("appointments").delete().in("availability_id", oldSlotIds);
    if (oldAppointmentsError) throw oldAppointmentsError;
    const { error: oldSlotsError } = await supabase.from("availability").delete().in("id", oldSlotIds);
    if (oldSlotsError) throw oldSlotsError;
  }

  const slots = [
    { start: nextMondayAtManila(9), minutes: 30, mode: "in_person", location: "CLIRDEC · LIVE TEST · Room 01" },
    { start: nextMondayAtManila(14), minutes: 45, mode: "online", location: "CLIRDEC · LIVE TEST · Faculty will provide meeting link" },
  ];
  const { data: insertedSlots, error: slotError } = await supabase.from("availability").insert(
    slots.map((slot) => ({
      faculty_id: user.id,
      starts_at: slot.start.toISOString(),
      ends_at: new Date(slot.start.getTime() + slot.minutes * 60_000).toISOString(),
      location: slot.location,
      consultation_mode: slot.mode,
      is_open: true,
    })),
  ).select("id,starts_at,ends_at,consultation_mode,location");
  if (slotError) throw slotError;
  accounts.push({
    email,
    user_id: user.id,
    name: profile.name,
    schedules: insertedSlots || [],
  });
  if (process.env.CONFIGURE_FACULTY_TEST_MFA === "true") {
    mfaSecrets[email] = await configureMfa(email);
  }
}

await writeFile(credentialFile, JSON.stringify({
  warning: "Test-only credentials. Do not commit or reuse.",
  project_ref: projectRef,
  password,
  accounts: accounts.map(({ email, user_id, name }) => ({ email, user_id, name })),
}, null, 2), { encoding: "utf8", mode: 0o600 });
try { await chmod(credentialFile, 0o600); } catch { /* Windows ACLs are managed by the host. */ }
if (Object.keys(mfaSecrets).length) {
  await writeFile(mfaFile, JSON.stringify(mfaSecrets, null, 2), { encoding: "utf8", mode: 0o600 });
  try { await chmod(mfaFile, 0o600); } catch { /* Windows ACLs are managed by the host. */ }
}

console.log(JSON.stringify({
  project_ref: projectRef,
  created_or_reset_accounts: accounts.length,
  account_emails: accounts.map((account) => account.email),
  schedules_per_account: 2,
  total_published_schedules: accounts.reduce((count, account) => count + account.schedules.length, 0),
  credential_file: credentialFile,
  mfa_file: Object.keys(mfaSecrets).length ? mfaFile : null,
  warning: "These are test identities and schedules. Remove them after testing; the online slots do not include a meeting link.",
}, null, 2));
