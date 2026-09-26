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

for (const name of [delivery, operations, suppression]) {
  if (!names.includes(name)) throw new Error(`Required ordered migration is missing: ${name}`);
}

const position = (name) => names.indexOf(name);
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

console.log(`Migration ordering passed (${names.length} ordered SQL files).`);
