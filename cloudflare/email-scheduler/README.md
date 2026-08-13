# CLIRDEC email scheduler

This Cloudflare Worker is the production scheduler for the protected Supabase
`send-email-notifications` Edge Function. Its Cron Trigger runs every five
minutes. GitHub Actions remains available only as a manual emergency backup.

## Deploy

```bash
npm ci
npx wrangler secret put EMAIL_CRON_SECRET
npm run check
npm run deploy
```

Use the same `EMAIL_CRON_SECRET` configured on the Supabase Edge Function and
the GitHub manual-backup workflow. Never add that value to `wrangler.toml`, a
GitHub file, or a public environment variable.

The cron expression is managed exclusively in `wrangler.toml`. Cloudflare may
take up to 15 minutes to propagate a new or changed Cron Trigger.

## Verify

1. Confirm the Worker deployment lists `*/5 * * * *` under Cron Triggers.
2. Check Cloudflare Cron Events for successful invocations.
3. Confirm Supabase Edge Function logs show HTTP 200 calls approximately every
   five minutes.
4. Run the GitHub workflow manually only when the Cloudflare scheduler is
   unavailable.
