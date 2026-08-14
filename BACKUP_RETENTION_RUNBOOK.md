# FacultyConnect backup, retention, and restore runbook

## Backup

1. Link the CLI to the production Supabase project.
2. Run `powershell -File scripts/backup-database.ps1 -OutputDirectory <encrypted-folder>`.
3. Move both SQL files and their SHA-256 hashes to CLSU-controlled encrypted storage.
4. Record the operator, date, Supabase project reference, and hash values in the release log.

Do not commit database dumps, place them in a shared public drive, or upload them as GitHub Actions artifacts.

## Restore drill

1. Create an isolated Supabase project containing no production integrations.
2. Restore the schema backup, followed by the data-only backup, using the Supabase CLI or `psql`.
3. point a temporary Preview deployment at the isolated project.
4. Run `npm run test:e2e` using dedicated `facultyconnect-e2e` accounts.
5. Confirm authentication, booking, approval, completion, review, reporting, and email queue creation.
6. Delete the isolated restored data after recording the result.

Run the drill before pilot launch and at least once each academic year. A backup is not considered verified until the restore drill succeeds.

## Retention

The administrator Operations page stores proposed retention periods and shows a preview of records older than each period. It never deletes records. Product Owner and CLSU privacy approval must be recorded before a policy is marked approved. Destructive retention automation requires a separate reviewed migration and change approval.
