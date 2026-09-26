# FacultyConnect UML source

`CLSU_FacultyConnect_UML.drawio` is the editable diagrams.net source for the three required UML diagrams:

1. Current manual consultation activity diagram
2. Proposed system use-case diagram
3. Production-aligned class diagram

The class diagram uses the database names in `supabase/schema.sql` and the ordered migrations. In particular:

- `Student.yearLevel` is a string matching the profile check constraint.
- `AvailabilitySlot` uses `startsAt`, `endsAt`, `consultationMode`, and `isOpen`.
- `ConsultationRequest` maps to `appointments`.
- `Notification` maps to `email_notifications`.
- `EmailDeliveryEvent` maps to `email_delivery_events`.
- `FacultyProfile` maps to `faculty_profiles`; the diagram does not invent an `AcademicUnit` table.
- `Administrator` is the `profiles.role = 'admin'` specialization and is protected by MFA in the production migrations.
- Supabase Auth, Cloudflare Turnstile, and the email service are separate external actors.
- CAPTCHA is included only when required, while chatbot trust-window expiry is represented as a conditional relationship.

Open the `.drawio` file in diagrams.net to export the diagrams to PDF or PNG for submission.
