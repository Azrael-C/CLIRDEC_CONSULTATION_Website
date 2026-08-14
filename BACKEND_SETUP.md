# Backend, Test Data, and Email Setup

Use a dedicated Supabase development or pilot project. Do not seed test users into a production project containing real student data.

## 1. Create the database

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql` once on a new project. For the existing pilot project, apply the versioned SQL files that have not yet run, including `supabase/chatbot_training_migration.sql` for administrator-managed example phrases, `supabase/active_user_presence_migration.sql` for the active-user monitor, and `supabase/migrations/20260814120000_operations_hardening.sql` for account lifecycle controls, retention previews, and operational monitoring. Deploy the matching frontend before applying the separate MFA enforcement migration described below.
4. Confirm that Row-Level Security is enabled on every public table.
5. Before a new student registers, approve the exact email in **MISO Administration → Manage users**. Approvals are single-use. Existing accounts are unaffected; faculty and administrator roles are assigned only by an administrator after registration.

## 2. Configure the frontend

Add these public values to Vercel Preview and Production:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Redeploy after changing Vite variables because they are included at build time.

For the Vercel Services deployment, leave `VITE_CHATBOT_URL` unset so the frontend uses the same-origin `/api` route. For a separate API host, set it to that host and never point production at `localhost`.

## 3. Deploy the FastAPI/spaCy service

`vercel.json` deploys the Vite frontend and `chatbot/app.py` as two Vercel Services in one project.

1. Configure `SUPABASE_URL` and a scoped `SUPABASE_SECRET_KEY` for the API service. The secret must remain server-side and must never use a `VITE_` prefix.
2. Keep `ALLOWED_ORIGINS` set to the production portal URL and approved local origins.
3. Confirm `/api/health` and `/api/knowledge-status` return successfully.
4. Confirm `/api/chat` answers a booking question, safely escalates a sensitive question, and reports an approved FAQ source when authenticated.

The service loads only FAQ rows whose status is `approved`. If Supabase is temporarily unavailable, it answers only the bundled consultation-workflow topics and safely escalates unsupported questions.

Administrators manage those entries in **Chatbot training**. Each draft requires an
official source, an approved answer, and at least two realistic student phrases.
Editing a live answer returns it to draft for a new approval check. Approved changes
can take up to five minutes to appear because the API caches the knowledge list.

## 4. Create guarded test data

Copy `supabase/.env.example` to a private local environment file and provide test-only email addresses plus a strong temporary password. Never commit that file.

PowerShell example:

```powershell
$env:ALLOW_TEST_SEED="true"
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SECRET_KEY="your-server-only-secret-key"
$env:TEST_STUDENT_EMAIL="your-test-student-address"
$env:TEST_FACULTY_EMAIL="your-test-faculty-address"
$env:TEST_ADMIN_EMAIL="your-test-admin-address"
$env:TEST_USER_PASSWORD="a-strong-temporary-password"
npm run seed:test
```

The seeder is rerunnable. It creates or updates three accounts, one faculty profile, three future availability slots, and one pending appointment. The appointment trigger also queues test email notifications.

## 5. Configure Resend

For initial testing, `onboarding@resend.dev` can send only to the email address associated with the Resend account. For multiple recipients, verify a sending domain and set `EMAIL_FROM` to that domain.

Set these Supabase Edge Function secrets:

```text
RESEND_API_KEY
EMAIL_FROM
EMAIL_CRON_SECRET
PORTAL_URL
```

`SUPABASE_URL` is supplied by the Supabase Edge Function environment. Store the scoped Edge Function key in the `edge_functions` member of the `SUPABASE_SECRET_KEYS` JSON secret.

Deploy the worker:

```powershell
supabase functions deploy send-email-notifications --no-verify-jwt
```

Invoke it manually for the first test:

```powershell
$headers=@{Authorization="Bearer $env:EMAIL_CRON_SECRET"}
Invoke-RestMethod -Method Post -Headers $headers -Uri "https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-email-notifications"
```

Expected response (counts depend on queue contents):

```json
{"processed":2,"sent":2,"failed":0,"remindersQueued":0,"reminderError":null}
```

Check `email_notifications` after the request. Successful rows must be `sent`; failures must contain `last_error` and retry later. The worker uses an atomic claim operation and a deterministic Resend idempotency key to limit duplicate sends.

## 6. Schedule processing

The production scheduler is `cloudflare/email-scheduler`. Its Cloudflare Cron Trigger calls the protected function every five minutes. Availability publication and request lifecycle events enter the outbox immediately. Confirmed consultations receive emails approximately one hour and 30 minutes before their start; the five-minute worker cadence is the delivery tolerance. Each invocation also drains and retries the outbox, so a second production reminder schedule is not required.

Configure the Worker secrets `SUPABASE_EMAIL_FUNCTION_URL` and `EMAIL_CRON_SECRET`, deploy it, and confirm `*/5 * * * *` appears under Cron Triggers. The GitHub `Email notification worker` is manual-only and is retained strictly as an emergency backup during a Cloudflare incident.

Before pilot testing, inspect Cloudflare Cron Events and confirm successful invocations five minutes apart, then verify that due rows in `email_notifications` transition to `sent`.

## 7. Dedicated lifecycle test

The manual `Pilot end-to-end lifecycle` GitHub workflow resets three dedicated test identities, books through the student UI, approves and completes through the faculty UI, submits a review, verifies the administrator report, invokes the protected email worker, and confirms the related outbox rows were sent. Configure the `pilot-e2e` GitHub environment with the secrets named in `.github/workflows/pilot-e2e.yml`. Every test email must contain `facultyconnect-e2e` so the guarded seeder cannot be pointed at genuine pilot users.

## 8. Resend delivery monitoring

Apply `supabase/resend_delivery_webhooks_migration.sql`, deploy `resend-webhook`, and add its `RESEND_WEBHOOK_SECRET` Supabase Function secret. In Resend, create a webhook pointing to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/resend-webhook` for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, and `email.failed`. The function verifies the raw request signature, ignores webhook replays by `svix-id`, and stores provider delivery evidence without exposing the signing secret to the browser.

## 9. Abuse protection

Create one Cloudflare Turnstile widget for `clsufacultyconnect.com` and `www.clsufacultyconnect.com`. Add its public site key to Vercel as `VITE_TURNSTILE_SITE_KEY` and its secret to the Vercel chatbot service as `TURNSTILE_SECRET_KEY`. In Supabase Authentication captcha protection, select Cloudflare Turnstile and add the same secret so login, registration, and password recovery reject unverified requests server-side. The chatbot requires Turnstile only for the first message, then issues a signed, HTTP-only trusted-chat cookie for `CHAT_TRUST_TTL_SECONDS` (30 minutes by default). Every message remains subject to `CHAT_RATE_LIMIT_PER_MINUTE`; exceeding the limit revokes the trusted window and requires a new challenge after the cooldown. Add a Cloudflare rate-limit rule for `/api/chat` for cross-instance enforcement.

`CHAT_TRUST_SECRET` is optional. When it is omitted, the API derives the chat-cookie signature from the server-only Turnstile secret with domain separation. Configure a separate long random value if MISO wants independent key rotation. Signing out calls `DELETE /api/chat/session` to clear the trusted-chat cookie immediately.

Production authentication and chatbot requests fail closed when these Turnstile values are absent. Keep `REQUIRE_TURNSTILE=true` in production. API documentation is disabled by default; use `ENABLE_API_DOCS=true` only in an isolated development environment.

After enabling captcha, verify all three authentication actions and one chatbot question on both desktop and mobile. Do not enable the Supabase captcha switch before the matching Vercel site key is deployed, or authentication will be blocked.

## 10. Branded password-recovery email

The version-controlled reset template is `supabase/templates/recovery.html`. Local Supabase reads it through `[auth.email.template.recovery]` in `supabase/config.toml`.

For the hosted project, open **Authentication -> Email Templates -> Reset password**, set the subject to `Reset your CLSU FacultyConnect password`, and paste the complete HTML template. Keep `{{ .ConfirmationURL }}` unchanged because Supabase replaces it with the signed, single-use recovery link. Confirm the production Site URL is `https://www.clsufacultyconnect.com` and that the same origin is in the redirect allow list. Disable link tracking in the SMTP provider because rewritten authentication links can fail verification.

Send a reset to a dedicated test account and verify the email design, link destination, password update, and subsequent login before publishing the template to pilot users.

Enable the **Password changed** security notification and apply `supabase/templates/password-changed.html` with the subject `Your CLSU FacultyConnect password was changed`. This gives users an immediate warning after an unexpected credential change.

## 11. Faculty discovery and chatbot improvement loop

Apply `supabase/faculty_discovery_chatbot_migration.sql`. When an administrator assigns the faculty role, the next faculty login prompts the user to complete verified expertise, subjects handled, accepted consultation topics, optional research interests, office location, and an introduction. **Skip for now** dismisses the prompt only for the current browser session; the profile remains incomplete and will not be used by the chatbot until saved.

The chatbot validates the Supabase login session before returning live directory information. It combines completed, active faculty profiles with future open availability, caches successful directory reads for `FACULTY_CACHE_SECONDS` (60 seconds by default), and identifies the source as `Live CLSU faculty profiles and published availability`. Empty or failed database reads are never presented as invented faculty matches or schedules.

Safe low-confidence questions are recorded through the server-only `record_chatbot_gap` function. Questions containing email addresses, long identification numbers, or sensitive-topic indicators are excluded. Administrators can review repeated gaps, start a source-backed FAQ draft, approve the final answer, or mark a gap reviewed from **Chatbot training**.

## 12. Privileged MFA and account lifecycle

The portal enrolls privileged users in TOTP and challenges them at sign-in. Roll this out in three ordered steps: apply `20260814120000_operations_hardening.sql`, deploy the matching frontend, then apply `20260814123000_enforce_privileged_mfa.sql`. The second migration requires an `aal2` Supabase session for faculty and administrator database permissions. Do not reverse this order, because existing privileged sessions must have the MFA gate available before database enforcement begins.

Because `supabase db push` applies every pending migration, use this controlled production sequence:

1. Run the complete phase-one SQL file in the Supabase SQL Editor.
2. Record it in CLI history with `npx supabase migration repair --linked --status applied 20260814120000`.
3. Deploy the frontend and confirm a faculty/admin login reaches the two-step verification screen.
4. Run `npx supabase db push --linked`; only `20260814123000_enforce_privileged_mfa.sql` should remain.
5. Sign in with TOTP as faculty and administrator, then run the complete lifecycle workflow.

Administrators can suspend, deactivate, or reactivate accounts from **Users and roles**. Restrictions are audited, faculty schedules close automatically, and existing database sessions are revoked. Public signup remains student-only. Faculty and administrator access must still be assigned by an authorized administrator.

## 13. Operations, retention, backup, and reporting

The **Operations and health** page shows delayed or failed email, Resend webhook evidence, privacy-filtered browser errors, privileged audit records, retention-policy previews, CSV exports, and printable release evidence. Retention is intentionally preview-only: the portal does not delete records automatically.

Follow `BACKUP_RETENTION_RUNBOOK.md` for encrypted backup handling and an isolated restore drill. Use `scripts/backup-database.ps1` with a private database URL. Never commit a backup or put one in a public CI artifact.

Confirmed and completed appointments offer `.ics` downloads and Google Calendar links. Lifecycle tests run nightly and on demand; public authentication and privacy pages are checked on desktop and mobile with Playwright and axe.
