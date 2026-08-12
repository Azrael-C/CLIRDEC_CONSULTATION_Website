# Backend, Test Data, and Email Setup

Use a dedicated Supabase development or pilot project. Do not seed test users into a production project containing real student data.

## 1. Create the database

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql` once on a new project. For the existing pilot project, apply the versioned SQL files that have not yet run, including `supabase/chatbot_training_migration.sql` for administrator-managed example phrases.
4. Confirm that Row-Level Security is enabled on every public table.
5. Before a new student registers, approve the exact email in **MISO Administration → Manage users**. Approvals are single-use. Existing accounts are unaffected; faculty and administrator roles are assigned only by an administrator after registration.

## 2. Configure the frontend

Add these public values to Vercel Preview and Production:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Redeploy after changing Vite variables because they are included at build time.

For the Vercel Services deployment, leave `VITE_CHATBOT_URL` unset so the frontend uses the same-origin `/api` route. For a separate API host, set it to that host and never point production at `localhost`.

## 3. Deploy the FastAPI/spaCy service

`vercel.json` deploys the Vite frontend and `chatbot/app.py` as two Vercel Services in one project.

1. Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the API service. Add `SUPABASE_SERVICE_ROLE_KEY` only if the approved server-side access pattern has been security-reviewed.
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
$env:SUPABASE_SERVICE_ROLE_KEY="your-server-only-key"
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

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by the Supabase Edge Function environment.

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

After manual testing succeeds, add these GitHub repository secrets:

```text
SUPABASE_EMAIL_FUNCTION_URL
EMAIL_CRON_SECRET
```

The `Email notification worker` workflow calls the protected function every five minutes. Availability publication and request lifecycle events enter the outbox immediately. Confirmed consultations receive emails approximately one hour and 30 minutes before their start; the five-minute worker cadence is the delivery tolerance. Each invocation also drains/retries the outbox, so a second reminder schedule is not required. Run the workflow manually once and confirm queued rows become `sent` before enabling pilot email expectations.

GitHub schedules can be delayed during high load. If the Product Owner requires exact-time delivery, move the same authenticated request to Supabase Cron while keeping the function and secret unchanged.
