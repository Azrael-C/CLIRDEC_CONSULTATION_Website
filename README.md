# Faculty Consultation Portal MVP

A mobile-first CLIRDEC pilot that can later expand into a university-wide faculty consultation portal.

See `TECH_STACK.md` for the complete development, testing, email, and deployment architecture.

## Team development

The production website is developed through GitHub issues, feature branches, pull requests, and automated checks. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting a Product Backlog item. Copy `.env.example` to `.env.local` for public local configuration; never commit service-role or email-provider credentials.

Before requesting review for frontend work, run:

```powershell
npm ci
npm run check
```

## Included

- Student, faculty, and administrator views
- Supabase authentication and role-based database policies
- Faculty availability and appointment tables
- Database-enforced double-booking protection
- FastAPI + spaCy consultation assistant with approved FAQ retrieval, live faculty/subject/availability matching, safe escalation, and an audited admin training workspace
- Responsive phone and desktop interface
- Backend email queue and protected Resend worker for Gmail or CLSU addresses
- Secure password recovery and student email-notification preferences
- Mandatory TOTP two-step verification for faculty and administrators
- Audited suspension, deactivation, and reactivation of user accounts
- Administrator health monitoring, retention previews, and CSV/PDF-ready reports
- `.ics` and Google Calendar actions for confirmed consultations
- Nightly full-lifecycle, desktop accessibility, and mobile accessibility tests

## Run the web app

1. Copy `.env.example` to `.env.local` and add the Supabase public credentials.
2. Run `npm ci`.
3. Run `npm run dev`.

Authentication requires a configured Supabase project; the production portal does not provide a fake sign-in mode.

## Configure Supabase

Create a Supabase project and run `supabase/schema.sql` in its SQL Editor. Never commit the real `.env` file. Students may self-register with a verified `@gmail.com` or `@clsu2.edu.ph` address. Public signup always creates a student account; faculty and administrator roles are assigned only through the administrator portal.

## Run the chatbot

```powershell
cd chatbot
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn app:app --reload --port 8000
```

The NLP service uses spaCy phrase matching, controlled bilingual intent rules, approved Supabase FAQ retrieval, verified faculty profiles, live published availability, source attribution, and safe staff escalation. Product Owner-approved answers and example student phrases are managed from **Administrator portal → Chatbot training**. Only approved entries and faculty-completed discovery profiles become available to students. Low-confidence questions are privacy-filtered and ranked in the administrator training queue.

Run the assistant checks after installing its requirements:

```powershell
python -m unittest -v test_app.py
```

## Configure appointment email notifications

Email is sent from the backend, never from React. The database trigger places messages in `email_notifications`; the protected Supabase Edge Function sends them. This supports Gmail recipients without asking users to keep the portal open.

1. Create a free Resend account and verify the sender domain/address.
2. Deploy `supabase/functions/send-email-notifications`.
3. Add these function secrets in Supabase: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_CRON_SECRET`, and `PORTAL_URL`. Supabase supplies its server-side database credentials to the Edge Function.
4. Configure and deploy `cloudflare/email-scheduler` with `SUPABASE_EMAIL_FUNCTION_URL` and `EMAIL_CRON_SECRET`. Cloudflare is the production five-minute scheduler; GitHub is a manual emergency backup only.
5. Test request submission, approval, decline, cancellation, and reminder emails with a Gmail address before the pilot.

The initial events are request receipt, faculty decision, schedule change/cancellation, and appointment reminder. Students can disable optional email notifications in their profile; legally or operationally required notices should be defined with the Product Owner before implementation.

Do not place Gmail passwords, Google app passwords, Resend keys, or the Supabase service-role key in `.env` variables beginning with `VITE_`; those values become visible in the browser bundle.

## Production operations

Use the zero-downtime rollout order in `BACKEND_SETUP.md`: apply `20260814120000_operations_hardening.sql`, deploy the frontend, and only then apply `20260814123000_enforce_privileged_mfa.sql`. The administrator **Operations and health** workspace monitors delivery failures, audit activity, browser errors, knowledge review dates, and approved retention periods without automatically deleting data.

Use [BACKUP_RETENTION_RUNBOOK.md](BACKUP_RETENTION_RUNBOOK.md) for backup and restore drills. Run `npm run test:a11y` for desktop and Pixel-sized public accessibility checks, and use the scheduled `Pilot end-to-end lifecycle` workflow for the complete student-to-admin consultation path.
