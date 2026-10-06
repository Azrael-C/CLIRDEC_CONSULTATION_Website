# FacultyConnect — Complete Student and Faculty Test Matrix

This matrix is the deep role-level companion to the protected pilot lifecycle. The lifecycle test proves one happy path; this matrix covers the role surfaces, validation rules, alternate states, and security boundaries that the happy path does not exercise.

## How to run

The role suite uses only the three dedicated `facultyconnect-e2e` identities and must run against a disposable/pilot Supabase project or the protected pilot environment. It must not use real student or faculty accounts.

```powershell
$env:E2E_BASE_URL = "https://www.clsufacultyconnect.com"
$env:ALLOW_TEST_SEED = "true"
npm run seed:test
npm run test:e2e:roles
```

The GitHub `pilot-e2e` workflow now runs the original lifecycle, resets the dedicated identities, and then runs the deep role suite. The suite is intentionally skipped when the protected E2E environment variables are absent.

## Result vocabulary

- **PASS** — executed and the expected behavior was observed.
- **PARTIAL** — a related path is covered, but this exact branch or boundary still needs execution.
- **NOT RUN** — requires a dedicated state, disposable mailbox, provider webhook, or isolated recovery environment.

## Student role

| ID | Area | Scenario | Expected result | Evidence / execution |
|---|---|---|---|---|
| STU-AUTH-01 | Authentication | Sign in with a confirmed student identity | Student reaches the student overview and only student navigation is visible | Protected pilot lifecycle; role suite |
| STU-AUTH-02 | Authentication | Wrong password / invalid credentials | Safe, non-enumerating error; no session is created | Execute with disposable identity |
| STU-AUTH-03 | Authentication | Sign out | Session is cleared and login is shown | Role suite |
| STU-AUTH-04 | Authentication | Reopen a protected route after sign out | Redirects to sign-in without portal data | Role suite |
| STU-AUTH-05 | Registration | Valid Gmail registration | Account is created, confirmation is required, and the same secure flow is used | Disposable mailbox required |
| STU-AUTH-06 | Registration | Valid `@clsu2.edu.ph` registration | Account is created and confirmation is required | Disposable mailbox required |
| STU-AUTH-07 | Registration | Unsupported email domain | Registration is blocked with a clear domain message | Execute |
| STU-AUTH-08 | Registration | Duplicate registered email | Safe duplicate response; no second profile is created | Execute |
| STU-AUTH-09 | Registration | Password rules | 8+ characters, uppercase, lowercase, number, and symbol are enforced | Public auth/a11y suite plus role suite |
| STU-AUTH-10 | Registration | Password mismatch | Submission is blocked and the confirmation error is clear | Execute |
| STU-AUTH-11 | Registration | Missing required academic fields | Submission is blocked at the missing field | Execute |
| STU-AUTH-12 | Recovery | Request reset for existing and unknown email | Same response is shown in both cases | Public route smoke; disposable mailbox for link delivery |
| STU-AUTH-13 | Recovery | Complete password reset | Link is time-limited; valid password updates; expired/used link is rejected | Disposable mailbox required |
| STU-NAV-01 | Navigation | Open Overview | Current request summary, guidance, and quick links render | Role suite |
| STU-NAV-02 | Navigation | Open Faculty availability | Published future slots and empty state are correct | Role suite |
| STU-NAV-03 | Navigation | Open My requests | Own requests only; status and history are shown | Protected lifecycle; role suite |
| STU-NAV-04 | Navigation | Open My profile | Academic fields and notification preference are shown | Role suite |
| STU-NAV-05 | Navigation | Mobile navigation | Sticky nav does not obscure sign-out, reports, forms, or modals | Mobile Playwright project |
| STU-DIR-01 | Faculty directory | Search by faculty name | Matching published slots appear | Role suite |
| STU-DIR-02 | Faculty directory | Search by subject/expertise | Matching faculty profile and subjects appear | Role suite |
| STU-DIR-03 | Faculty directory | Search with no match | No-results state is useful and does not leak unrelated data | Role suite |
| STU-DIR-04 | Faculty directory | Published slot later today, still in the future | Booking remains enabled; a same-day request can be submitted | Execute with controlled near-term slot |
| STU-DIR-05 | Faculty directory | Expired/withdrawn slot | Slot is absent from the published student list | Execute |
| STU-BKG-01 | Booking | Submit valid topic and notes | Pending request is created and confirmation appears | Protected lifecycle; role suite |
| STU-BKG-02 | Booking | Topic shorter than five characters | Submission is blocked with an actionable message | Execute |
| STU-BKG-03 | Booking | Topic/notes at maximum length | Boundary is accepted; longer input is blocked | Execute |
| STU-BKG-04 | Booking | Submit without a topic | Required validation prevents submission | Execute |
| STU-BKG-05 | Booking | Two students attempt one slot concurrently | Exactly one active appointment succeeds; other receives safe conflict | Isolated write-load test required |
| STU-BKG-06 | Booking | Book a slot that was just withdrawn | Safe conflict/availability message; no orphan appointment | Execute |
| STU-APT-01 | Requests | View pending request | Pending status and faculty details are visible | Role suite |
| STU-APT-02 | Requests | Faculty approves | Status changes to Confirmed; notification is visible | Protected lifecycle |
| STU-APT-03 | Requests | Faculty declines | Status changes to Declined; reason/email path is preserved | Role suite |
| STU-APT-04 | Requests | Cancel pending request | Status changes to Cancelled and audit history remains | Role suite |
| STU-APT-05 | Requests | Cancel confirmed request | Status changes to Cancelled and participants are notified | Execute |
| STU-APT-06 | Requests | Reschedule to another open slot | Original is cancelled only after replacement is reserved; new request is pending | Role suite |
| STU-APT-07 | Requests | Reschedule to same/closed/past slot | Submission is rejected without changing the active request | Execute |
| STU-APT-08 | Calendar | Download `.ics` for confirmed/completed appointment | Calendar file contains correct time, location, and status | Execute |
| STU-APT-09 | Calendar | Add confirmed appointment to Google Calendar | URL has correct title, times, timezone, and location | Execute |
| STU-REV-01 | Reviews | Review completed consultation with 1–5 stars | Rating is saved and appears as Saved | Protected lifecycle; role suite |
| STU-REV-02 | Reviews | Review with open comment | Comment is retained and visible to authorized admin only | Protected lifecycle |
| STU-REV-03 | Reviews | Review comment boundaries | Empty is allowed if policy permits; >1,000 chars is blocked | Execute |
| STU-REV-04 | Reviews | Review pending/declined/cancelled appointment | Review form is unavailable | Execute |
| STU-REV-05 | Reviews | Submit duplicate review | Duplicate is prevented or existing review is explicitly updated | Execute |
| STU-PRO-01 | Profile | Update name, college, program, year level | Values persist after refresh and are used in review snapshots | Role suite |
| STU-PRO-02 | Profile | Toggle email notifications | Preference persists and changes explanatory text | Execute |
| STU-PRO-03 | Profile | Invalid profile values | Validation blocks empty/overlong values | Execute |
| STU-AI-01 | Consult AI | View approved-information landing state | Source/safety guidance is visible | Role suite |
| STU-AI-02 | Consult AI | First chatbot message | Turnstile is required once per session and a response is source-backed | Protected authenticated chat run |
| STU-AI-03 | Consult AI | Subsequent chatbot message | No repeated CAPTCHA inside the trust window; rate limit remains active | Execute |
| STU-AI-04 | Consult AI | Clear chat | Conversation returns to the initial message and input clears | Role suite |
| STU-AI-05 | Consult AI | Unsupported/sensitive question | Safe fallback and staff referral; no invented answer | Execute |
| STU-AI-06 | Consult AI | Report an issue | Privacy-filtered report is accepted and visible to admin operations | Role suite |
| STU-AI-07 | Consult AI | Excessive chatbot requests | Server-side rate limit returns safe feedback without crashing the page | Controlled abuse test |
| STU-ERR-01 | Resilience | Network failure while loading portal | Existing records remain visible; retry/error state is understandable | Route-failure Playwright test |
| STU-ERR-02 | Resilience | Offline/empty availability | Empty state explains what the student can do next | Execute |
| STU-ERR-03 | Resilience | Loading and submitting states | Buttons show progress and duplicate submissions are prevented | Execute |
| STU-ERR-04 | Support | Submit a portal issue report | Success is confirmed in the dialog; failure leaves the details available to retry | Execute |
| STU-WALKIN-01 | Consultation history | Faculty records a past in-person consultation | Student sees a completed, clearly labeled record without booking actions or a review form | Execute with same-unit test accounts |

## Faculty role

| ID | Area | Scenario | Expected result | Evidence / execution |
|---|---|---|---|---|
| FAC-AUTH-01 | Authentication | Sign in with faculty identity | Faculty workspace is shown and MFA is required | Protected pilot lifecycle; role suite |
| FAC-AUTH-02 | Authentication | Invalid MFA code | Access remains blocked and no faculty data is shown | Execute |
| FAC-AUTH-03 | Authentication | Sign out / session expiry | Session is revoked and protected faculty routes redirect | Execute |
| FAC-ONB-01 | Onboarding | First faculty sign-in | Profile completion prompt appears with Save and Skip for now | Role suite |
| FAC-ONB-02 | Onboarding | Skip profile onboarding | Faculty can enter the portal and can complete the profile later | Execute |
| FAC-ONB-03 | Onboarding | Save profile onboarding | Expertise, subjects, consultation topics, research interests, bio, and location persist | Role suite |
| FAC-PRO-01 | Profile | Edit expertise categories | Values are normalized, deduplicated, and visible to students | Role suite |
| FAC-PRO-02 | Profile | Edit subjects/courses | Students can search the updated subjects | Role suite |
| FAC-PRO-03 | Profile | Edit consultation topics | Chatbot/directory can use approved topics | Execute |
| FAC-PRO-04 | Profile | Edit research interests, bio, office location | Optional fields persist without exposing private data | Role suite |
| FAC-PRO-05 | Profile | Overlong label/bio/location | Server and client validation reject unsafe lengths | Execute |
| FAC-AVL-01 | Availability | Open weekday calendar | Monday–Friday dates, Philippine timezone, and future-only rule are clear | Role suite |
| FAC-AVL-02 | Availability | Change duration (15/20/30/45/60/90/120) | Selected duration highlights the correct calendar range | Role suite |
| FAC-AVL-03 | Availability | Select past/weekend/current-time cell | Past/current and weekend cells are disabled; a future same-day cell is allowed | Execute |
| FAC-AVL-04 | Availability | Publish in-person slot | Slot appears in published schedule and student directory | Role suite |
| FAC-AVL-05 | Availability | Choose online mode | Warning explains FacultyConnect does not create the meeting link | Role suite |
| FAC-AVL-06 | Availability | Publish online slot with link/instructions | Location/link is required, saved, and shown to approved participants | Role suite |
| FAC-AVL-07 | Availability | Publish without location/link | Submission is blocked | Execute |
| FAC-AVL-08 | Availability | Publish overlapping slot | Database exclusion and friendly error prevent overlap | Execute |
| FAC-AVL-09 | Availability | Publish exact duplicate slot | Unique constraint/friendly error prevents duplicate | Execute |
| FAC-AVL-10 | Availability | Remove open slot | Slot closes and disappears from student availability | Role suite |
| FAC-AVL-11 | Availability | Remove reserved slot | Slot is locked; removal is rejected to protect the request | Execute |
| FAC-AVL-12 | Availability | Real-time student reflection | Student view updates after publish/remove or refreshes within the documented interval | Execute with two browser contexts |
| FAC-REQ-01 | Requests | View pending request and student note | Correct student/topic/schedule details are visible | Role suite |
| FAC-REQ-02 | Requests | Approve request | Status becomes confirmed and student email is queued | Protected lifecycle; role suite |
| FAC-REQ-03 | Requests | Decline request | Status becomes declined and student email is queued | Role suite |
| FAC-REQ-04 | Requests | Approve/decline already decided request | Action is rejected and state remains unchanged | Execute |
| FAC-REQ-05 | Requests | Complete an ended confirmed consultation | Status becomes completed and history is retained | Role suite |
| FAC-REQ-06 | Requests | Complete before the end time | Button is disabled or server rejects the action | Execute |
| FAC-REQ-07 | Requests | Download `.ics` and Google Calendar event | Correct appointment details are exported | Role suite |
| FAC-REQ-08 | Requests | View pending/approved/completed filters | Counts and records match the database | Role suite |
| FAC-REQ-09 | In-person consultation history | Log a past consultation without a web booking | Completed record is visible to its student, recording faculty, and authorized admins; audit entry exists; no booking/email is created | Execute with same-unit test accounts |
| FAC-REQ-10 | In-person consultation history | Search student or attempt cross-unit/unauthorized logging | Search returns only active same-unit students; non-faculty and cross-unit writes are denied | Isolated authorization test |
| FAC-EMAIL-01 | Notifications | New request email | Faculty receives one request notification | Protected lifecycle |
| FAC-EMAIL-02 | Notifications | Decision email | Student receives one approval/decline email | Protected lifecycle; role suite |
| FAC-EMAIL-03 | Notifications | Schedule change/cancellation email | Both participants are notified and outbox record is auditable | Execute |
| FAC-EMAIL-04 | Reminders | 60-minute and 30-minute reminders | Each eligible reminder is delivered exactly once | Disposable timed appointments required |
| FAC-EMAIL-05 | Provider webhook | Bounce/suppressed/delivered event | Resend event is recorded and operations page surfaces the failure | Provider webhook test required |
| FAC-SEC-01 | Authorization | Faculty cannot access another faculty member's requests | RLS/RPC ownership check rejects the request | Isolated authorization test |
| FAC-SEC-02 | Authorization | Faculty cannot edit another faculty profile/slot | Update is rejected without data leakage | Isolated authorization test |
| FAC-SEC-03 | Authorization | Faculty cannot access admin routes | Admin UI and data are unavailable | Role suite / route test |
| FAC-ERR-01 | Resilience | Availability publish network failure | Form preserves input and shows retryable failure | Route-failure Playwright test |
| FAC-ERR-02 | Resilience | Realtime disconnect | Existing schedule remains visible and focus/retry restores freshness | Execute |
| FAC-ERR-03 | Resilience | Empty request/schedule states | Empty states explain the next action | Role suite |

## Shared security and non-functional gates

These gates apply to both roles and should be run after the role suite:

1. Run `npm run check` on a clean checkout.
2. Run `npm run test:a11y` at desktop and mobile widths in light and dark themes.
3. Run `npm run test:production` against `https://www.clsufacultyconnect.com`.
4. Verify protected routes, RLS, Turnstile, rate limits, security headers, `/docs` and `/openapi.json` behavior.
5. Run an isolated authenticated concurrency test; the existing public 100-bot baseline is not a capacity result for authenticated writes.
6. Export and restore a backup in an isolated Supabase project, then compare representative profile, availability, appointment, review, FAQ, email, audit, and telemetry records.

The role suite provides the repeatable browser layer. Provider delivery, backup restoration, authenticated load, and exact time-threshold reminders remain explicit environment gates rather than silently being reported as passed.
