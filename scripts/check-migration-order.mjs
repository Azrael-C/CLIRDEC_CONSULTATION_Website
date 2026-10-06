import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrationDir = resolve(root, "supabase", "migrations");
const names = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const delivery = "20260814110000_email_delivery_events.sql";
const operations = "20260814120000_operations_hardening.sql";
const suppression = "20260820170848_track_resend_suppressed_events.sql";
const bookingWalkIn = "20261006150000_flexible_booking_and_walk_in_consultations.sql";
const position = (name) => names.indexOf(name);

for (const name of [delivery, operations, suppression]) {
  if (!names.includes(name)) throw new Error(`Required ordered migration is missing: ${name}`);
}
if (!names.includes(bookingWalkIn)) throw new Error(`Required ordered migration is missing: ${bookingWalkIn}`);
if (position(bookingWalkIn) <= position(operations)) {
  throw new Error("Flexible booking and in-person history must be applied after the existing appointment workflow.");
}

if (!(position(delivery) < position(operations) && position(delivery) < position(suppression))) {
  throw new Error("Email delivery schema must precede operations and suppression migrations.");
}

const deliverySql = readFileSync(resolve(migrationDir, delivery), "utf8");
for (const expected of [
  "create table if not exists public.email_delivery_events",
  "grant select,insert on public.email_delivery_events to service_role",
  "'email.suppressed'",
]) {
  if (!deliverySql.includes(expected)) throw new Error(`Email delivery migration is missing: ${expected}`);
}

const schema = readFileSync(resolve(root, "supabase", "schema.sql"), "utf8");
if (!schema.includes("create table if not exists public.email_delivery_events")) {
  throw new Error("The canonical bootstrap schema is missing email_delivery_events.");
}
for (const expected of ["provider_email_id text", "provider_status text", "provider_status_at timestamptz", "email_notifications_provider_email_id"]) {
  if (!schema.includes(expected)) throw new Error(`The canonical bootstrap schema is missing: ${expected}`);
}

const legacySql = readFileSync(resolve(root, "supabase", "resend_delivery_webhooks_migration.sql"), "utf8");
if (!legacySql.includes("LEGACY COMPATIBILITY FILE")) {
  throw new Error("Standalone email delivery SQL must be explicitly marked as legacy.");
}

const bookingWalkInSql = readFileSync(resolve(migrationDir, bookingWalkIn), "utf8");
for (const expected of [
  "create table if not exists public.walk_in_consultations",
  "alter publication supabase_realtime add table public.walk_in_consultations",
  "enable row level security",
  "create or replace function public.search_walk_in_students",
  "create or replace function public.record_walk_in_consultation",
  "public.can_access_academic_unit(academic_unit_id)",
  "revoke all on table public.walk_in_consultations from anon, authenticated",
  "grant select on table public.walk_in_consultations to authenticated",
  "walk_in_consultation_recorded",
  "p.academic_unit_id=actor_unit",
  "Consultation time must be in the future",
  "set is_open=(starts_at>now())",
]) {
  if (!bookingWalkInSql.includes(expected)) throw new Error(`Walk-in/flexible booking migration is missing: ${expected}`);
}
if (bookingWalkInSql.includes("interval '24 hours'")) {
  throw new Error("The flexible booking migration still enforces a fixed 24-hour notice window.");
}
if (!schema.includes("create table if not exists public.walk_in_consultations")) {
  throw new Error("The canonical bootstrap schema is missing the in-person consultation log.");
}

console.log(`Migration ordering passed (${names.length} ordered SQL files).`);
