# FacultyConnect backup, retention, and restore runbook

## Backup

1. Link the CLI to the production Supabase project.
2. Ensure Docker Desktop is running (the Supabase CLI uses a containerized `pg_dump`) and run `powershell -File scripts/backup-database.ps1 -OutputDirectory <encrypted-folder>`.
3. Move both SQL files and the generated `.sha256` manifest to CLSU-controlled encrypted storage.
4. Record the operator, date, Supabase project reference, and hash values in the release log.

Do not commit database dumps, place them in a shared public drive, or upload them as GitHub Actions artifacts.

## Restore drill

1. Create an isolated Supabase project containing no production integrations.
2. Install PostgreSQL client tools (`psql`) and set `FACULTYCONNECT_RESTORE_DATABASE_URL` to the isolated project's connection string. Never use the production URL.
3. Run `powershell -File scripts/verify-backup-restore.ps1 -BackupDirectory <encrypted-folder>`; it verifies the matching `.sha256` manifest when present, restores schema and data, and checks that public tables exist. The verifier accepts `schema.sql`/`data.sql` or the newest matching timestamped pair created by the backup script.
4. Point a temporary Preview deployment at the isolated project.
5. Run `npm run test:e2e` using dedicated `facultyconnect-e2e` accounts.
6. Confirm authentication, booking, approval, completion, review, reporting, and email queue creation.
7. Delete the isolated restored data after recording the result.

Run the drill before pilot launch and at least once each academic year. A backup is not considered verified until the restore drill succeeds.

## Retention

The administrator Operations page stores proposed retention periods and shows a preview of records older than each period. It never deletes records. Product Owner and CLSU privacy approval must be recorded before a policy is marked approved. Destructive retention automation requires a separate reviewed migration and change approval.
