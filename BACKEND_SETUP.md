
# Backend, Test Data, and Email Setup

Use a dedicated Supabase development or pilot project. Do not seed test users into a production project containing real student data.

## 1. Create the database

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql` once on a new project.
4. Confirm that Row-Level Security is enabled on every public table.

## 2. Configure the frontend

Add these public values to Vercel Preview and Production:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Redeploy after changing Vite variables because they are included at build time.

## 3. Create guarded test data

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

## 4. Configure Resend

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

Expected response:

```json
{"processed":2,"sent":2,"failed":0}
```

Check `email_notifications` after the request. Successful rows must be `sent`; failures must contain `last_error` and retry later. The worker uses an atomic claim operation and a deterministic Resend idempotency key to limit duplicate sends.

## 5. Schedule processing

After manual testing succeeds, schedule an authenticated POST every five minutes using Supabase Cron or another approved scheduler. Store the cron secret in the scheduler; never place it in browser code.
