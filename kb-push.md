---
description: >
  Commit and push the Audm app to the afajardodelgado/audm GitHub repository.
  Use this when the user says "push", "sync", "upload to GitHub", "push to repo",
  or any variation of committing and pushing changes. Push directly to main —
  no branches, no pull requests.
---

# Audm Push Skill

Push verified app changes to `origin main`.

## Rules

1. **Always push directly to `origin main`.** No branches, no pull requests, no rebasing onto other branches.
2. **Never commit secrets or local data.** The following must never be staged (they are gitignored, but verify every time): `.env` and any `.env.*` except `.env.example`, `dev.db` / `*.db`, `data/`, `.next/`, `node_modules/`, `.claude/`. `.env.example` (placeholders only) *is* committed.
3. **Verify before pushing.** Run `npx tsc --noEmit` (and `npm run build` for non-trivial changes). Do not push a broken build.
4. **Commit message format**: short summary line, then a blank line and a body if the change needs explaining. End with the Co-Authored-By trailer.
5. **One logical change per commit.** If the working tree mixes unrelated changes, make separate commits.
6. **Do not amend or force push.** Always create a new commit. If the push is rejected because the remote moved, run `git pull --rebase origin main`, re-verify, then push.

## Steps

1. `git status` and `git branch --show-current` — confirm what changed and that you're on `main` (if not, switch or fast-forward `main` to include the commits before pushing).
2. **Secret safety check** — confirm nothing sensitive is staged:
   ```
   git add -A --dry-run | grep -iE "(^|/)\.env$|\.env\.[^ ]*$|\.db$|(^|/)data/|scheduled_tasks\.lock" | grep -v "\.env\.example"
   ```
   This should print nothing. If it prints a path, stop and fix `.gitignore` before continuing.
3. Stage the change: `git add -A` (or stage specific files for a focused commit).
4. Review: `git diff --cached --stat` — confirm only intended files are included.
5. Verify: `npx tsc --noEmit` (add `npm run build` for non-trivial changes). Must pass.
6. Commit:
   ```
   git commit -m "$(cat <<'EOF'
   <summary of changes>

   <optional body: what and why>

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```
7. Push: `git push origin main`
8. Confirm `origin/main` advanced (`git ls-remote origin -h refs/heads/main`) and report the commit hash to the user.
