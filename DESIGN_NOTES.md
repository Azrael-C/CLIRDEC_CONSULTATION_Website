
# FacultyConnect design prototype

This iteration translates the low-fidelity wireframe into a complete responsive CLSU/MISO interface for Student, Faculty, and Admin users.

## Included interactions

- Demo sign-in for Student, Faculty, and Admin roles
- Responsive student overview and mobile navigation
- Faculty search by name or expertise
- Booking review and confirmation modal
- Confirmed consultations added to My Schedule
- Demo AI assistant responses
- Faculty dashboard, request review, availability grid, and profile
- MISO Admin dashboard, user and appointment management, chatbot knowledge base, and reports
- CLSU green-and-yellow theme with Libre Franklin typography
- CLIRDEC identified as the pilot site for a university-wide portal

## Interview-aligned scope

- Consult AI and the approved FAQ knowledge base are the primary MVP capability.
- The assistant demonstrates clarification, safe fallback, and official staff referral.
- Faculty availability is explicitly faculty-maintained and is not automatic expertise matching.
- Students submit consultation requests; a published time is not shown as confirmed until faculty approval.
- Full cancellation, rescheduling, reminders, feedback, and advanced analytics remain deferred.
- MISO Admin maintains drafts and review status, while final content approval belongs to the Product Owner or designated CLIRDEC approving officer.
- Pilot QA tracks the provisional 80% FAQ accuracy, 3-second response, 80% task completion, and 4/5 satisfaction targets.
- Registered Gmail or CLSU addresses receive request receipts, faculty decisions, schedule changes/cancellations, and appointment reminders through a protected backend email queue.

## Visual decisions

- General Faculty Consultation Portal identity with CLIRDEC clearly labeled as the pilot
- Consistent cards, spacing, typography, buttons, forms, and status labels
- Green academic palette with coral emphasis and accessible contrast
- Desktop sidebar that becomes a mobile menu
- Mobile-friendly cards instead of wide tables for the core student workflow

## Running locally

From the project folder:

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. XAMPP can remain active for PHP/MySQL, but Vite serves the React design during development.
