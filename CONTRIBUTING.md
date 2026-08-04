
# Contributing to CLSU FacultyConnect

## Branch workflow

1. Pull the latest `main`.
2. Create a branch named `feature/<short-name>`, `fix/<short-name>`, or `docs/<short-name>`.
3. Work on one GitHub issue or user story per branch.
4. Keep credentials and real personal data out of commits.
5. Run the relevant checks before opening a pull request.
6. Request review from at least one teammate.
7. Merge only after acceptance criteria pass.

## Local checks

Frontend:

```powershell
npm install
npm run check
```

Chatbot:

```powershell
py -m venv chatbot\.venv
chatbot\.venv\Scripts\Activate.ps1
pip install -r chatbot\requirements.txt
python -m compileall -q chatbot
```

## Definition of Done

- Acceptance criteria pass.
- Changes are integrated with the current application.
- Role and privacy implications were reviewed.
- Phone and desktop layouts were tested for UI changes.
- Loading, empty, success, and error states are handled.
- No secrets, credentials, or unnecessary personal data are committed.
- Another team member reviewed the pull request.
- Setup or behavior changes are documented.

## Commit examples

```text
feat: add student consultation request form
fix: prevent faculty schedule double booking
docs: document Supabase local configuration
test: add chatbot intent test cases
```
