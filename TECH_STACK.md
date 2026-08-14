
# CLSU FacultyConnect — Updated Technical Stack

## Recommended pilot architecture

| Layer | Technology | Purpose | Pilot cost |
|---|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Student, faculty, and MISO interfaces | Free / open source |
| Styling | Responsive CSS + Libre Franklin | CLSU-aligned, mobile-first interface | Free |
| Client routing | React Router | Role-based pages and navigation | Free / open source |
| Authentication | Supabase Auth + TOTP MFA | Student sign-in and mandatory two-step verification for faculty/administrators | Free tier |
| Database | Supabase PostgreSQL | Profiles, approved availability, consultation requests, FAQ knowledge, audit records, and email queue | Free tier |
| Authorization | PostgreSQL Row-Level Security | Separate student, faculty, and administrator permissions | Included with Supabase |
| Server functions | Supabase Edge Functions | Protected email processing and administrative operations | Free tier for the pilot |
| NLP API | Python + FastAPI + spaCy | Controlled FAQ intent recognition and safe fallback | Free / open source |
| NLP hosting | Vercel Services | Hosts FastAPI/spaCy beside the frontend under the same production domain | Included in the pilot Vercel project; function size and response time remain release checks |
| Transactional email | Resend | Sends receipts, decisions, changes, cancellations, and reminders to Gmail/CLSU email | Provider limits must be checked before pilot launch |
| Frontend hosting | Vercel | HTTPS website deployment and GitHub-based updates | Free Hobby tier for an academic pilot |
| Source control | GitHub | Team collaboration, branches, reviews, and deployment integration | Free |
| Local development | XAMPP + Node.js + Python | XAMPP may continue serving local assets/tools; Vite runs the React development server | Free |

## Why this separation is needed

The React site is a static browser application, while spaCy requires a Python server process. XAMPP cannot run the production React and Python services by itself. During development:

- XAMPP can remain available for familiar localhost access.
- Vite serves the React application on `http://localhost:5173`.
- FastAPI serves the NLP chatbot on `http://localhost:8000`.
- Supabase supplies the shared cloud database and authentication.

For deployment, Vercel Services deploys the React build and FastAPI/spaCy service in one project. Supabase and Resend remain managed services.

## Required for the MVP

### Frontend

- React, TypeScript, and Vite
- Responsive Student, Faculty, and MISO Admin interfaces
- Consult AI as the primary Student feature
- Faculty-approved availability and request submission
- Pending/approved/declined consultation states
- Accessible forms, status labels, error states, loading states, and phone layouts

### Backend and data

- Supabase Auth and PostgreSQL
- Row-Level Security for Student, Faculty, and Admin roles
- Tables for profiles, faculty profiles, availability, consultation requests, approved FAQs, audit records, and email notifications
- Database-enforced protection against double booking
- Minimum necessary personal data only
- Backup/export procedure for pilot data
- Audited account suspension/deactivation and privileged-session revocation
- Administrator email, audit, browser-error, retention, and service-health monitoring
- `.ics` and Google Calendar actions for confirmed, completed, and cancelled consultations

### NLP chatbot

- FastAPI REST endpoint
- spaCy tokenization and controlled intent/keyword recognition
- Product Owner-approved FAQ answers and sources
- English, Filipino, mixed English-Filipino, abbreviations, and short conversational phrasing in the test set
- Low-confidence clarification followed by approved topics or staff referral
- Blocking/referral for grades, confidential records, complaints, emergencies, disciplinary matters, counseling, and unapproved information
- Logging of unanswered questions without storing unnecessary sensitive conversation history

### Email notifications

- Request receipt to the student
- New-request notice to the faculty member
- Approval or decline notice to the student
- Schedule-change or cancellation notice to affected users
- Reminder for a confirmed consultation
- Retry status, failure log, and duplicate prevention
- Email provider credentials stored only in Supabase server secrets

## Development tools

- Visual Studio Code
- Git and GitHub
- Node.js LTS with npm
- Python 3.13 with a virtual environment to match CI and production
- Supabase CLI for schema migrations and Edge Function deployment
- Postman or Bruno for API testing; FastAPI `/docs` is development-only and disabled in production
- Browser responsive-mode testing for phone and desktop layouts

The repository is standardized on npm and `package-lock.json`; do not add a second package-manager lockfile.

## Testing stack

| Test | Recommended tool |
|---|---|
| React component/unit tests | Vitest + React Testing Library |
| Browser workflow tests | Playwright |
| Python API tests | Pytest + FastAPI TestClient |
| Database/security tests | Supabase local development + SQL/RLS test cases |
| Accessibility checks | axe-core + Playwright desktop/mobile checks plus keyboard/manual review |
| Pilot acceptance | Approved FAQ test set and representative Student/Faculty task scripts |

The acceptance targets remain provisional until Product Owner confirmation: at least 80% FAQ accuracy, response within three seconds under normal pilot conditions, at least 80% task completion, average satisfaction of 4/5, safe fallback for unsupported questions, and no critical security or privacy defect.

## Deployment map

```text
Student / Faculty / MISO browser
              |
       Vercel project
        /           \
React + Vite    FastAPI + spaCy
        \           /
         Supabase Auth/DB
                |
Supabase email outbox + Edge Function
                |
              Resend
                |
Registered Gmail / CLSU email
```

## Environment variables

Frontend variables may contain only public client configuration:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_CHATBOT_URL
VITE_TURNSTILE_SITE_KEY
VITE_RELEASE
```

Server-only secrets:

```text
SUPABASE_SECRET_KEY
SUPABASE_SECRET_KEYS
RESEND_API_KEY
EMAIL_FROM
EMAIL_CRON_SECRET
PORTAL_URL
TURNSTILE_SECRET_KEY
CHAT_TRUST_SECRET
```

Never prefix server secrets with `VITE_`, commit them to GitHub, or place them in browser code.

## Deferred technologies

Do not add these during the initial pilot unless the Product Owner expands scope:

- Large language model or unrestricted generative-AI API
- Vector database or embeddings
- Automatic faculty ranking or performance scoring
- Push notifications or SMS
- Two-way Google/Microsoft calendar synchronization (downloadable `.ics`, cancellation updates, and Google Calendar links are included)
- Full machine-learning recommendation engine
- Advanced analytics warehouse
- Mobile application separate from the responsive website

The controlled spaCy FAQ classifier is sufficient for demonstrating NLP while keeping answers approved, testable, explainable, and feasible within the academic pilot.
