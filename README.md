
# Faculty Consultation Portal MVP

A mobile-first CLIRDEC pilot that can later expand into a university-wide faculty consultation portal.

See `TECH_STACK.md` for the complete development, testing, email, and deployment architecture.

## Included

- Student, faculty, and administrator views
- Supabase authentication and role-based database policies
- Faculty availability and appointment tables
- Database-enforced double-booking protection
- FastAPI + spaCy FAQ/intent chatbot with safe escalation
- Responsive phone and desktop interface
- Email notifications delivered to registered Gmail or CLSU addresses
- Demo mode when Supabase is not configured

## Run the web app

1. Copy `.env.example` to `.env` and add Supabase credentials when available.
2. Run `pnpm install`.
3. Run `pnpm dev`.

Without credentials, sign in using any valid-looking email and a six-character password to use demo mode.

## Configure Supabase

Create a free Supabase project and run `supabase/schema.sql` in its SQL Editor. Never commit the real `.env` file. In production, restrict account registration to your institutional email domain and assign faculty/admin roles through an approved administrator workflow.

## Run the chatbot

```powershell
cd chatbot
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn app:app --reload --port 8000
```

The first NLP increment uses spaCy tokenization and a controlled intent vocabulary. Replace the sample answers with Product Owner-approved CLIRDEC content before pilot acceptance.

## Configure appointment email notifications

Email is sent from the backend, never from React. The database trigger places messages in `email_notifications`; the protected Supabase Edge Function sends them. This supports Gmail recipients without asking users to keep the portal open.

1. Create a free Resend account and verify the sender domain/address.
2. Deploy `supabase/functions/send-email-notifications`.
3. Add these function secrets in Supabase: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_CRON_SECRET`, and `PORTAL_URL`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function.
4. Schedule an authenticated call to the function every minute using Supabase Cron or another trusted scheduler. Send `Authorization: Bearer <EMAIL_CRON_SECRET>`.
5. Test request submission, approval, decline, cancellation, and reminder emails with a Gmail address before the pilot.

The initial events are request receipt, faculty decision, schedule change/cancellation, and appointment reminder. Users can disable optional email notifications in their profile; legally or operationally required notices should be defined with the Product Owner before implementation.

Do not place Gmail passwords, Google app passwords, Resend keys, or the Supabase service-role key in `.env` variables beginning with `VITE_`; those values become visible in the browser bundle.
