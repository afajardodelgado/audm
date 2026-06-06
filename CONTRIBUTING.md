# Contributing / Developer Guide

How to run Audm locally, verify changes, and ship them. For system design see [ARCHITECTURE.md](./ARCHITECTURE.md); for a feature overview see [README.md](./README.md).

## Prerequisites

- **Node.js 18+** (the PDF cover/OCR rendering uses `@napi-rs/canvas`, a prebuilt native module — no Cairo build needed, but a recent Node is required).
- **npm 10+**.

No database server is required for local development — it uses SQLite.

## Running locally

```bash
npm install                # postinstall runs `prisma generate`
cp .env.example .env       # defaults are fine for local SQLite
npm run dev                # Next.js dev server on http://localhost:3000
```

- Local dev uses **SQLite** (`dev.db`) and stores uploaded files + covers under **`./data`** (`./data/<userId>/<documentId>.<ext>` and `.cover.png`).
- If port 3000 is busy, `next dev` will pick another port (e.g. 3001) — but if a previous `npm run dev` is already running it will exit instead. Stop the old one first (`lsof -iTCP:3000 -sTCP:LISTEN` to find the PID).

### First-run database

`dev.db` is gitignored. If you don't have one, create the schema from the migrations:

```bash
npx prisma migrate dev     # applies migrations, regenerates the client
```

There is no seed data; the shelf starts empty and you populate it by importing.

## Quality gates

Run these before pushing. The push workflow expects type-check (and build, for non-trivial changes) to pass.

```bash
npx tsc --noEmit           # type-check
npm run lint               # eslint
npm run build              # full production build (includes a tsc pass)
```

> **Lint noise:** `npm run lint` reports a large number of errors that originate from `src/generated/prisma/**` (the minified generated Prisma client, which the current ESLint config doesn't ignore). To see only real findings:
>
> ```bash
> npm run lint 2>&1 | grep -E "^/Users|^[A-Za-z]:" | grep -v "src/generated"
> ```
>
> When judging whether your change added problems, compare against the baseline rather than the absolute count. Adding `src/generated` to the ESLint ignores is a welcome cleanup.

## Verifying behavior

Two tools beyond the static checks:

- **Screenshots** — capture the shelf and reader from a running dev server:
  ```bash
  node scripts/screenshot.mjs               # uses http://localhost:3000
  node scripts/screenshot.mjs http://localhost:3001
  ```
  Output lands in `/tmp/audm-shots/` (`01-shelf.png`, `02-reader.png`). The reader shot uses the first `ready` document from `/api/documents`. Requires the dev server running and `playwright` installed (it's a dev dependency).

- **API smoke tests** — the endpoints are plain JSON and easy to exercise with `curl` against a running server (list/get documents, import text, create a highlight + comment, PATCH progress, delete). See the [API reference](./ARCHITECTURE.md#http-api-reference) for shapes.

## Database: SQLite ↔ Postgres

The schema is written for SQLite (`provider = "sqlite"`) and kept portable (no Postgres-only types). The provider is switched by **environment + a build step**, not by editing the schema by hand:

- `scripts/set-db-provider.mjs` reads `DATABASE_PROVIDER` (`sqlite` | `postgresql`) and rewrites the single `provider = "..."` line in `prisma/schema.prisma`.
- `src/lib/db.ts` picks the matching Prisma driver adapter at runtime from the same env var.

Relevant `package.json` scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | `next dev` |
| `npm run db:provider` | Run `set-db-provider.mjs` |
| `npm run build` | `db:provider` → `prisma generate` → `next build` |
| `npm start` | `next start` (local) |
| `npm run start:railway` | `db:provider` → `prisma migrate deploy` → `next start` |
| `npm run lint` | `eslint` |

When changing the schema: edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>` locally (SQLite). Migrations are applied in production by `prisma migrate deploy` (run via `start:railway`).

## Deployment (Railway)

Configured in `railway.json` (NIXPACKS builder):

- **Build:** `npm run build` — flips the datasource to Postgres (`DATABASE_PROVIDER=postgresql`), generates the client, builds the standalone Next.js output.
- **Start:** `npm run start:railway` — re-confirms the provider, runs `prisma migrate deploy`, then `next start`.
- **Volume:** uploaded files/covers are written under `RAILWAY_VOLUME_MOUNT_PATH` (injected by Railway). The volume mounts at runtime only — never write to it at build time.
- **Health check:** `/`.

Set in the Railway environment: `DATABASE_PROVIDER=postgresql` and `DATABASE_URL` (Railway's managed Postgres). Supabase variables are optional until auth is enabled.

## Pushing changes

This repo pushes **directly to `main`** (no branches/PRs) via the workflow in [`kb-push.md`](./kb-push.md). The essentials:

1. **Never commit secrets or local data.** Already gitignored, but verify every time: `.env` / `.env.*` (except `.env.example`), `dev.db` / `*.db`, `data/`, `.next/`, `node_modules/`, `.claude/`, `eng.traineddata`.
2. **Verify before pushing:** `npx tsc --noEmit` (and `npm run build` for non-trivial changes). Don't push a broken build.
3. One logical change per commit; conventional summary line; end the message with the `Co-Authored-By` trailer.
4. Don't amend or force-push. If the remote moved, `git pull --rebase origin main`, re-verify, push.

## Conventions worth knowing

- **Next.js 16 specifics:** this is a newer Next than most references assume. Route handler `params` are a `Promise` (`await params`). The reader page is `force-dynamic`. PDF/EPUB/OCR/canvas packages are listed in `serverExternalPackages` so their native/worker deps resolve at runtime — add new native packages there too. See `node_modules/next/dist/docs/` for the in-tree guides (per `AGENTS.md`).
- **Don't edit `src/generated/`** — it's the generated Prisma client (regenerated by `prisma generate`).
- **Shared helpers, not copies:** centralized utilities exist for a reason — reuse them. Limits/tunables live in `src/lib/constants.ts`; ownership-scoped lookups in `src/lib/db.ts` (`findOwned*`); text utilities in `src/lib/extract/segment.ts` (`normalizeWhitespace`, `countWords`, `countBlocksWords`, `splitSentences`); sid parsing in `src/lib/anchor.ts` (`parseSid`); client fetch in `src/lib/api.ts` (`postForDocument`, `normalizeDoc`); file paths in `src/lib/storage.ts`.
