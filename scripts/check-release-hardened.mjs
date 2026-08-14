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
const completeEmailMigration = read("supabase/complete_email_notifications_migration.sql");
const chatbotTrainingMigration = read("supabase/chatbot_training_migration.sql");
const presenceMigration = read("supabase/active_user_presence_migration.sql");
const chatbot = read("chatbot/app.py");
const resendWebhook = read("supabase/functions/resend-webhook/index.ts");
const deliveryMigration = read("supabase/resend_delivery_webhooks_migration.sql");
const recoveryEmail = read("supabase/templates/recovery.html");
const passwordChangedEmail = read("supabase/templates/password-changed.html");
const securityContact = read("public/.well-known/security.txt");
const app = read("src/App.tsx");
const backend = read("src/backend.ts");
const styles = read("src/figma.css");
const vercel = read("vercel.json");

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
assertIncludes(worker, "consultationDetails", "Consultation and availability email detail content");
assertIncludes(worker, "CLSU FacultyConnect", "Branded email template");
assertIncludes(worker, 'timeZone: "Asia/Manila"', "Philippine email date formatting");
assertIncludes(worker, "For your privacy", "Email privacy guidance");
assertIncludes(worker, "expiredSlotsClosed", "Expired availability maintenance");
assertIncludes(worker, "availability_published", "Availability publication email template");
assertIncludes(worker, "reminder_60_minutes", "One-hour reminder email template");
assertIncludes(worker, "reminder_30_minutes", "Thirty-minute reminder email template");
assertIncludes(completeEmailMigration, "queue_availability_email", "Availability publication email queue");
assertIncludes(completeEmailMigration, "reminder_60_minutes", "One-hour reminder queue");
assertIncludes(completeEmailMigration, "reminder_30_minutes", "Thirty-minute reminder queue");
assertIncludes(completeEmailMigration, "array[new.student_id,faculty_user]", "Both consultation participants notified");
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
assertIncludes(schema, "training_phrases text[]", "Chatbot training phrase storage");
assertIncludes(chatbotTrainingMigration, "faq_training_phrases_limit", "Training phrase database limit");
assertIncludes(app, "Build, verify, and improve Consult AI", "Administrator chatbot training page");
assertIncludes(app, "Test the live chatbot", "Administrator chatbot test console");
assertIncludes(app, "Currently active users", "Administrator presence monitor");
assertIncludes(app, "recordUserPresence(user.id)", "Authenticated presence heartbeat");
assertIncludes(backend, "last_seen_at", "Administrator presence data loading");
assertIncludes(presenceMigration, "profiles_last_seen_at_idx", "Presence activity index");
assertIncludes(backend, "normalizeTrainingPhrases", "Training phrase input validation");
assertIncludes(chatbot, "training_phrases", "spaCy approved phrase retrieval");
assertIncludes(chatbot, 'os.getenv("SUPABASE_SECRET_KEY")', "Server-only chatbot database credential");
assertIncludes(chatbot, "if not items:", "Empty chatbot result fallback");
if (chatbot.includes('_cache = (time.monotonic() + 60, [], "bundled workflow answers")')) {
  throw new Error("Failed chatbot retrieval still poisons the global knowledge cache.");
}
assertIncludes(chatbot, "TURNSTILE_SECRET_KEY", "Chatbot Turnstile validation");
assertIncludes(chatbot, "CHAT_RATE_LIMIT", "Chatbot request rate limit");
assertIncludes(chatbot, "CHAT_TRUST_COOKIE", "Signed chatbot trust window");
assertIncludes(chatbot, "httponly=True", "HTTP-only chatbot trust cookie");
assertIncludes(chatbot, "_expired_chat_cookie_header", "Chat trust revocation on security rejection");
assertIncludes(chatbot, "_turnstile_required", "Production chatbot fail-closed protection");
assertIncludes(chatbot, 'docs_url="/docs" if API_DOCS_ENABLED else None', "Production API documentation control");
assertIncludes(app, "PRODUCTION_SECURITY_READY", "Production authentication fail-closed protection");
assertIncludes(vercel, "Cross-Origin-Opener-Policy", "Cross-origin opener isolation header");
assertIncludes(resendWebhook, "new Webhook(webhookSecret).verify", "Resend webhook signature verification");
assertIncludes(resendWebhook, 'eventError?.code === "23505"', "Resend webhook replay protection");
assertIncludes(deliveryMigration, "provider_email_id", "Email provider identifier storage");
assertIncludes(deliveryMigration, "email_delivery_events", "Email delivery event evidence");
assertIncludes(styles, "padding-bottom: calc(6.25rem + env(safe-area-inset-bottom))", "Mobile drawer bottom clearance");
assertIncludes(functionConfig, "verify_jwt = false", "Custom-secret worker configuration");
assertIncludes(functionConfig, "[auth.email.template.recovery]", "Local recovery email configuration");
assertIncludes(recoveryEmail, "{{ .ConfirmationURL }}", "Secure recovery link");
assertIncludes(recoveryEmail, "{{ .Email }}", "Recovery email recipient context");
assertIncludes(recoveryEmail, "If you did not request this change", "Recovery email safety guidance");
assertIncludes(functionConfig, "[auth.email.notification.password_changed]", "Password-change notification configuration");
assertIncludes(passwordChangedEmail, "If you did not", "Password-change security guidance");
assertIncludes(securityContact, "security/advisories/new", "Private vulnerability reporting contact");
for (const sql of [schema, reviewMigration]) {
  assertIncludes(sql, "consultation_reviews", "Consultation review storage");
  assertIncludes(sql, "submit_consultation_review", "Secure review submission");
  assertIncludes(sql, "Only your completed consultations may be reviewed", "Completed-consultation review gate");
  assertIncludes(sql, "year_level", "Review year-level snapshot");
  assertIncludes(sql, "college", "Review college snapshot");
  assertIncludes(sql, "program", "Review program snapshot");
}

console.log("Release hardening checks passed.");
