# FacultyConnect production security hardening

This document records the controls verified in the repository on 2026-08-22,
the controls implemented with this change, and the remaining operator actions.
The production architecture is Vercel + Supabase + Cloudflare Turnstile and a
Cloudflare email scheduler. The Linux, Nginx, Apache, Docker, and Kubernetes
examples below apply only if the FastAPI service is self-hosted.

## Priority remediation

### Critical — complete before real student records are entered

1. **Rotate the previously disclosed Supabase service credential.** Create a
   modern server-side `sb_secret_...` key, replace `SUPABASE_SECRET_KEY` in the
   Vercel chatbot service and `SUPABASE_SECRET_KEYS` in Supabase Edge Functions,
   redeploy, test, and revoke the disclosed legacy `service_role` JWT. Never use
   a secret key in a `VITE_` variable.
2. **Enable leaked-password protection.** Supabase's security advisor currently
   reports `auth_leaked_password_protection`. Enable Authentication → Password
   Security → Leaked password protection, then rerun the advisor.
3. **Review privileged RPCs before the pilot.** Sixteen intentionally callable
   `SECURITY DEFINER` functions remain in the exposed `public` schema. The
   workflow RPCs validate `auth.uid()`, role, ownership, MFA, and lock affected
   rows, but they still deserve a separate negative-permission test suite. Move
   policy-only helper functions to a non-exposed schema and expose workflow
   mutations through narrowly scoped functions or Edge Functions over time.

### High

1. Enable Vercel WAF managed protection where the plan supports it. Add rules in
   **log mode first**, inspect traffic, and then enforce:
   - `/api/chat`: 30 requests/minute/IP, challenge or rate limit.
   - Authentication traffic to the Supabase Auth hostname: retain Supabase
     CAPTCHA and Auth rate limits; it does not pass through this Vercel project.
   - Block unexpected methods to `/api/*`; allow `GET`, `POST`, `DELETE`, and
     preflight `OPTIONS` only.
2. Delete or archive eleven obsolete public tables after a confirmed backup:
   `admin_profiles`, `appointment_feedback`, `chat_messages`, `chat_sessions`,
   `chatbot_feedback`, `chatbot_kb`, `monthly_clirdec_metrics`, `notifications`,
   `staff_profiles`, `time_slots`, and `users`. They are currently fail-closed
   (RLS enabled with no policies), but unused schemas increase audit surface.
3. Move `btree_gist` from `public` to an extensions schema during a maintenance
   window and verify the availability exclusion constraint afterward.
4. Add automated IDOR tests for every student/faculty/admin RPC using two users
   per role. A valid UUID belonging to another user must be rejected.
5. Add persisted security/event logs (Vercel Log Drain or another approved
   sink), alert on repeated 401/403/429 responses, email suppression, and RPC
   authorization failures.

### Medium

1. Replace public-schema policy helpers with private-schema helpers using
   `security definer set search_path = ''` and fully qualified table names.
2. Add a controlled load test for `/api/chat` and appointment booking. Do not run
   it against production without an agreed maintenance window and rate limits.
3. Add a DNS inventory review each term: remove stale CNAMEs, verify Vercel and
   Resend records, enable DNSSEC at the registrar if supported, and publish CAA.
   The 2026-08-22 review found no CAA answer for `clsufacultyconnect.com`.
4. Pin GitHub Actions to full commit SHAs as a further supply-chain safeguard.
5. Create a recovery exercise that restores Supabase backups into an isolated
   project and verifies RLS before declaring the restore successful.

## Verified controls

- React renders text using normal JSX; no `dangerouslySetInnerHTML`, DOM HTML
  injection, shell execution, or user-controlled outbound URL handler was found.
- Browser data access uses Supabase's query builder/RPC parameters rather than
  interpolated SQL. Postgres workflow functions lock booking rows with
  `FOR UPDATE`, preventing double booking and reschedule TOCTOU issues.
- All active application tables use RLS. Browser code uses only the Supabase
  publishable key; service credentials remain server-side.
- Login, registration, recovery, and the first chatbot message use Turnstile.
  The chatbot retains server-side burst/per-minute rate limiting after CAPTCHA.
- Password recovery returns the same success message whether an account exists.
  Login feedback does not distinguish a missing account from a wrong password.
- Faculty/admin access is gated by MFA-aware `current_role()` checks.
- The app sends a strict CSP, HSTS, clickjacking, MIME-sniffing, referrer, and
  browser permissions headers from `vercel.json`.
- Chatbot outbound requests are restricted to HTTPS `*.supabase.co` hosts and a
  fixed Cloudflare Turnstile endpoint. No user-supplied URL is fetched.
- Resend webhooks verify Svix signatures and handle duplicate webhook IDs.
- npm dependencies and the Cloudflare worker use committed lockfiles; CI runs
  `npm audit`. Chatbot CI now also runs `pip-audit`.
- The chatbot accepts at most 500 characters per question. Its API now rejects
  request bodies over 16 KiB and cancels work after 12 seconds by default.
- The container runs as UID/GID 10001 and Uvicorn limits concurrency, keepalive,
  and requests per worker.

## Important architecture notes

### CSRF

Supabase browser mutations use an `Authorization: Bearer` header, not an
automatically attached authentication cookie. Cross-site forms cannot add that
header, and RLS/RPC authorization still runs server-side. The chatbot trust
cookie is `HttpOnly`, `Secure` in production, and `SameSite=Lax`; it authorizes
only skipping a repeat CAPTCHA, not database access. Its JSON POST also requires
a non-simple content type and passes the CORS allow-list. If a future backend
introduces cookie-authenticated state changes, add a signed, session-bound
cookie-to-header CSRF token before release.

### Password storage

The application never stores password hashes. Supabase Auth owns password
verification and hashing. Do not add passwords to the `profiles` table, logs,
analytics, or custom email functions.

### XSS and third-party scripts

There are no raw HTML rendering calls in the active React app. Cloudflare
Turnstile loads dynamically, so Subresource Integrity is not practical for that
vendor-managed script. Keep `script-src` limited to `self` and Cloudflare and do
not add arbitrary CDNs. User comments are rendered as React text. If user links
are later introduced, validate `https:` destinations and add
`rel="ugc nofollow noopener noreferrer"`.

## Vercel and Cloudflare operator checklist

1. Vercel Firewall → enable monitoring and create log-only rules before block or
   challenge actions. Do not deploy new WAF enforcement without reviewing real
   traffic and emergency bypass steps.
2. Vercel Deployment Protection → protect preview deployments; production stays
   public behind app authentication.
3. Vercel Observability → retain runtime logs outside the default short window.
4. Supabase Authentication → keep Turnstile enabled and set conservative Auth
   rate limits for sign-in, signup, and password recovery.
5. Cloudflare DNS → publish CAA records appropriate to the actual certificate
   authorities. For Vercel-managed TLS, start with:

   ```dns
   clsufacultyconnect.com.  CAA 0 issue "letsencrypt.org"
   clsufacultyconnect.com.  CAA 0 issue "pki.goog"
   clsufacultyconnect.com.  CAA 0 issuewild "letsencrypt.org"
   clsufacultyconnect.com.  CAA 0 issuewild "pki.goog"
   ```

   Confirm the currently issued certificate chain before restricting CAA; an
   incorrect CAA record can prevent renewal.

## Self-hosted Linux examples (not used by Vercel)

### PAM limits

Create `/etc/security/limits.d/facultyconnect.conf`:

```text
facultyconnect soft nproc 128
facultyconnect hard nproc 256
facultyconnect soft nofile 4096
facultyconnect hard nofile 8192
facultyconnect hard core 0
```

PAM limits are per login session and are not a substitute for systemd or
container cgroups.

### PHP (only if a separate PHP application is introduced)

FacultyConnect does not use PHP. For a future PHP-FPM reverse proxy, start with:

```ini
expose_php = Off
display_errors = Off
log_errors = On
max_execution_time = 20
max_input_time = 20
memory_limit = 128M
post_max_size = 1M
upload_max_filesize = 1M
max_input_vars = 500
allow_url_include = Off
enable_dl = Off
disable_functions = exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec
session.cookie_secure = 1
session.cookie_httponly = 1
session.cookie_samesite = Lax
```

Validate required application functions before enforcing `disable_functions`.

### Ready-to-adapt deployment configurations

The repository includes copyable baselines for self-hosting the chatbot:

- `deploy/security/facultyconnect.service` — systemd process, memory, CPU,
  task, filesystem, privilege, and syscall-family restrictions.
- `deploy/security/nginx-facultyconnect.conf` — Nginx body/time limits,
  connection/rate controls, method restrictions, TLS headers, and proxy bounds.
- `deploy/security/apache-facultyconnect.conf` — Apache request/time/method
  limits and equivalent security headers.
- `deploy/security/docker-compose.hardened.yml` — non-root, read-only,
  PID/memory/CPU/file-descriptor limits, dropped capabilities, and no-new-
  privileges.
- `deploy/security/kubernetes-chatbot.yaml` — non-root Kubernetes deployment,
  immutable-image placeholder, seccomp, dropped capabilities, read-only root,
  resource limits, health probes, and disruption budget.
- `deploy/security/kubelet-config.yaml` — node-level `podPidsLimit`. Kubernetes
  does not expose a portable per-Pod PID field, so apply this through the
  cluster provider's node-pool configuration and verify its effect in staging.

Replace hostnames, certificate directives, image digest, secret names, and
provider-specific settings before use. These files are references only; the
current production deployment remains Vercel and Supabase.

## Verification commands

```powershell
npm ci
npm audit --omit=dev --audit-level=high
npm run check
python -m pip install pip-audit==2.10.1
python -m pip_audit -r chatbot/requirements.txt
Push-Location chatbot
python -m unittest -v test_app.py
Pop-Location
```

Also rerun Supabase Security and Performance Advisors after every migration and
perform the Playwright pilot lifecycle with dedicated non-production accounts.
