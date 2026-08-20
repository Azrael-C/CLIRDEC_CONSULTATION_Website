# CLSU FacultyConnect

[CLSU FacultyConnect](https://www.clsufacultyconnect.com) is a mobile-first faculty consultation portal piloted by MISO and CLIRDEC. Students discover faculty expertise, book published times, receive updates, and review completed consultations. Faculty manage profiles, availability, and requests. Authorized administrators oversee accounts, approved chatbot knowledge, insights, and service health.

## Features

- Student self-registration for verified Gmail and `@clsu2.edu.ph` addresses
- Shared secure sign-in with student, faculty, and administrator workspaces
- Faculty expertise profiles and weekday availability publishing
- Database-enforced booking, rescheduling, cancellation, and double-booking protection
- FastAPI + spaCy assistant using approved FAQs and live faculty data
- Resend confirmations, decisions, cancellations, and 60/30-minute reminders
- Consultation ratings and insights by year level, college, and program
- TOTP multi-factor authentication for faculty and administrators
- Responsive light and dark themes with accessible public workflows
- Operational email, chatbot, audit, error, retention, and restore evidence

## Architecture

```text
React + Vite browser application
  ├─ Supabase Auth (email confirmation, CAPTCHA, MFA, sessions)
  ├─ Supabase Postgres (RLS, role-checked RPCs, Realtime)
  ├─ Vercel FastAPI service (spaCy retrieval chatbot)
  └─ Supabase Edge Functions (Resend email + delivery webhooks)

Cloudflare
  ├─ Turnstile on public authentication and first chatbot message
  └─ Worker Cron draining the email queue every five minutes
```

Production deploys from `main` to Vercel. Database changes live in `supabase/migrations`. Follow [BACKEND_SETUP.md](BACKEND_SETUP.md) for the required rollout order.

| Area | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite |
| Auth and database | Supabase Auth, Postgres, RLS, Realtime |
| Chatbot | Python, FastAPI, spaCy controlled retrieval |
| Email | Supabase Edge Functions, Resend, Cloudflare Worker Cron |
| Hosting | Vercel multi-service deployment |
| Testing | TypeScript, Node checks, Python `unittest`, Playwright, axe |

See [TECH_STACK.md](TECH_STACK.md) for detailed design choices.

## Local setup

Requirements: Node.js 24+, npm 11+, Python 3.13+, and the Supabase CLI for database work.

```powershell
git clone https://github.com/Azrael-C/CLIRDEC_CONSULTATION_Website.git
cd CLIRDEC_CONSULTATION_Website
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Public browser configuration in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe `sb_publishable_...` key |
| `VITE_CHATBOT_URL` | Local chatbot URL; production uses `/api` |
| `VITE_TURNSTILE_SITE_KEY` | Public Cloudflare Turnstile site key |

Never put a Supabase secret/service-role key, Resend key, Turnstile secret, or scheduler secret in a `VITE_` variable. Vite exposes every `VITE_` value to the browser.

### Run the chatbot

```powershell
py -m venv chatbot\.venv
chatbot\.venv\Scripts\Activate.ps1
pip install -r chatbot\requirements.txt
Copy-Item chatbot\.env.example chatbot\.env
python -m uvicorn chatbot.app:app --reload --port 8000
```

The chatbot accepts 2–500 characters, requires Turnstile on the first message in a trusted window, and applies per-client burst and minute limits. Vercel Firewall supplies a second edge layer in production.

## Backend and deployment

```powershell
npx supabase link --project-ref <project-ref>
npx supabase migration list
npx supabase db diff --linked
npx supabase db push --linked
npx supabase functions deploy send-email-notifications --no-verify-jwt
npx supabase functions deploy resend-webhook --no-verify-jwt
```

Configure server-only secrets in Supabase/Vercel, then open a pull request to `main`. GitHub Actions and the Vercel preview must pass before merge. Server secret names and full rollout instructions are in [BACKEND_SETUP.md](BACKEND_SETUP.md); backup and retention drills are in [BACKUP_RETENTION_RUNBOOK.md](BACKUP_RETENTION_RUNBOOK.md).

## Security model

- Supabase CAPTCHA protects sign-in, registration, and password recovery.
- Turnstile protects the first chatbot message; signed HttpOnly trust avoids challenging every message.
- Supabase Auth applies provider endpoint limits; the chatbot adds burst/minute limits and an edge limit.
- RLS protects application tables, and privileged database workflows verify the signed-in role.
- Faculty and administrators must reach Authenticator Assurance Level 2 using TOTP.
- CSP, HSTS, frame denial, content-type protection, strict referrers, and restrictive permissions are returned by Vercel.
- Administrative changes, client errors, and email delivery events are auditable.

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/Azrael-C/CLIRDEC_CONSULTATION_Website/security/advisories/new). Never put credentials or student information in a public issue. See [SECURITY.md](SECURITY.md).

## Verification

```powershell
npm run check
npm run test:a11y
npm run test:e2e
npm run test:production
python -m unittest -v chatbot/test_app.py
npm audit --omit=dev --audit-level=high
```

The scheduled E2E workflow verifies:

```text
student books → faculty approves → faculty completes → student reviews → admin sees report
```

## Team workflow

1. Start from an updated `main`.
2. Use `feature/`, `fix/`, `security/`, or `docs/` branches.
3. Keep one Product Backlog outcome per pull request.
4. Include acceptance criteria and test evidence.
5. Require teammate review and passing checks before squash-merging.

Read [CONTRIBUTING.md](CONTRIBUTING.md). Do not commit `.env*`, `.vercel`, Supabase CLI state, test credentials, exports, or real pilot data.

## Repository map

```text
src/                         React application and role workspaces
chatbot/                     FastAPI + spaCy service and tests
supabase/migrations/         Ordered database changes
supabase/functions/          Email worker and Resend webhook
cloudflare/email-scheduler/  Five-minute production scheduler
scripts/                     Release, smoke, schedule, and seed checks
e2e/                         Playwright lifecycle and accessibility tests
.github/workflows/           CI, smoke, and scheduled E2E
public/                      Logos and public metadata files
```

## Data and branding

This academic pilot repository does not grant permission to copy CLSU branding or process real university data outside authorized environments. Consult the Product Owner and CLSU/MISO policies before expanding the pilot or changing retention rules.
