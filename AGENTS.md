# Repository instructions

- The active frontend is `src/`, built with the npm scripts in `package.json`.
- The production API is `chatbot/app.py`; do not add endpoints to legacy scaffolding.
- Database changes must be new ordered files in `supabase/migrations/` and preserve RLS.
- Never commit `.env*`, `.vercel/`, `supabase/.temp/`, credentials, exports, or real pilot data.
- Use browser-safe Supabase publishable keys in React. Secret/service-role keys are server-only.
- Run `npm run check` and chatbot unit tests for relevant changes.
- Test UI changes at phone and desktop widths in light and dark themes.
- Use feature branches and reviewed pull requests; do not push feature work directly to `main`.
