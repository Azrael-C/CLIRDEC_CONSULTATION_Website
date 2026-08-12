import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const assertIncludes = (content, expected, label) => {
  if (!content.includes(expected)) throw new Error(`${label} is missing: ${expected}`);
};

const schema = read("supabase/schema.sql");
const migration = read("supabase/release_hardening_migration.sql");
const worker = read("supabase/functions/send-email-notifications/index.ts");
const functionConfig = read("supabase/config.toml");

for (const sql of [schema, migration]) {
  assertIncludes(sql, "registration_allowlist", "Controlled registration SQL");
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
assertIncludes(functionConfig, "verify_jwt = false", "Custom-secret worker configuration");

console.log("Release hardening checks passed.");
