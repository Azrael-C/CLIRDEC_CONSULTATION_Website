import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const assertIncludes = (content, expected, label) => {
  if (!content.includes(expected)) throw new Error(`${label} is missing: ${expected}`);
};

const schema = read("supabase/schema.sql");
const migration = read("supabase/release_hardening_migration.sql");
const worker = read("supabase/functions/send-email-notifications/index.ts");
const functionConfig = read("supabase/config.toml");
const reviewMigration = read("supabase/consultation_reviews_migration.sql");
const auditMigration = read("supabase/production_audit_hardening_migration.sql");
const realtimeMigration = read("supabase/realtime_portal_migration.sql");
const registrationMigration = read("supabase/student_email_domain_registration_migration.sql");
const app = read("src/App.tsx");
const backend = read("src/backend.ts");
const styles = read("src/figma.css");

for (const sql of [schema, migration]) {
  assertIncludes(sql, "gmail\\.com|clsu2\\.edu\\.ph", "Student email-domain registration SQL");
  assertIncludes(sql, "can_read_profile", "Profile privacy SQL");
  assertIncludes(sql, "faculty_directory", "Safe faculty directory SQL");
  assertIncludes(sql, "processing_started_at", "Email worker lease SQL");
  assertIncludes(
    sql,
    "revoke all on function public.queue_due_appointment_reminders() from public,anon,authenticated",
    "Reminder scheduler permissions",
  );
}

if (schema.includes('create policy "read profiles"')) {
  throw new Error("The broad authenticated profile-read policy is still present.");
}
assertIncludes(worker, '"queue_due_appointment_reminders"', "Reminder queue invocation");
assertIncludes(worker, '"claim_email_notifications"', "Email claim invocation");
assertIncludes(worker, "Idempotency-Key", "Idempotent email delivery");
assertIncludes(worker, "appointmentDetails", "Appointment detail email content");
assertIncludes(worker, "CLSU FacultyConnect", "Branded email template");
assertIncludes(worker, 'timeZone: "Asia/Manila"', "Philippine email date formatting");
assertIncludes(worker, "For your privacy", "Email privacy guidance");
assertIncludes(worker, "expiredSlotsClosed", "Expired availability maintenance");
assertIncludes(auditMigration, "revoke all on table public.appointments from anon,authenticated", "Least-privilege appointment grants");
assertIncludes(auditMigration, "grant select,insert on public.availability to authenticated", "Faculty availability grants");
assertIncludes(auditMigration, "revoke all on function public.create_profile()", "Trigger function permissions");
assertIncludes(realtimeMigration, "supabase_realtime add table public.availability", "Availability realtime publication");
assertIncludes(realtimeMigration, "supabase_realtime add table public.appointments", "Appointment realtime publication");
assertIncludes(registrationMigration, "gmail\\.com|clsu2\\.edu\\.ph", "Production student registration domains");
assertIncludes(registrationMigration, "'student'", "Student-only public registration role");
assertIncludes(app, "@gmail.com or @clsu2.edu.ph", "Student signup domain guidance");
if (app.includes("Approve a student registration") || app.includes("Approve email")) {
  throw new Error("The legacy per-email registration approval UI is still present.");
}
assertIncludes(app, 'table: "availability"', "Student availability realtime subscription");
assertIncludes(app, "slot.booking_open", "Student booking-window display state");
assertIncludes(backend, '.gt("starts_at", now)', "Future availability visibility");
assertIncludes(backend, "Date.now() + MINIMUM_NOTICE_MS", "Minimum-notice booking gate");
assertIncludes(styles, "padding-bottom: calc(6.25rem + env(safe-area-inset-bottom))", "Mobile drawer bottom clearance");
assertIncludes(functionConfig, "verify_jwt = false", "Custom-secret worker configuration");
for (const sql of [schema, reviewMigration]) {
  assertIncludes(sql, "consultation_reviews", "Consultation review storage");
  assertIncludes(sql, "submit_consultation_review", "Secure review submission");
  assertIncludes(sql, "Only your completed consultations may be reviewed", "Completed-consultation review gate");
  assertIncludes(sql, "year_level", "Review year-level snapshot");
  assertIncludes(sql, "college", "Review college snapshot");
  assertIncludes(sql, "program", "Review program snapshot");
}

console.log("Release hardening checks passed.");
