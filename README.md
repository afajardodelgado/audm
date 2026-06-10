# Audm

**A place to read.** Audm turns documents into a calm, reflowable reading experience with neural narration. Upload a PDF or EPUB, paste text, or drop in an article URL — Audm extracts the prose, reflows it into clean paragraphs, and reads it aloud in a natural voice that runs entirely in your browser. Click any sentence to start narration there (Speechify-style), highlight passages, leave comments, and pick up exactly where you left off.

## Features

- **Import anything** — PDF, EPUB, pasted text, or a web article URL (extracted with Mozilla Readability).
- **Neural narration** — in-browser text-to-speech via [Kokoro](https://github.com/hexgrad/kokoro), with word-level read-along highlighting. No audio API keys, no server round-trips — the voice model runs client-side (WebGPU, falling back to WASM).
- **Click-to-narrate** — click a sentence to start reading aloud from there. Adjustable speed (0.75×–3×).
- **Auto-scroll** — a silent reading mode that paces the page at a configurable WPM when narration isn't used.
- **Scanned PDF OCR** — PDFs with no text layer are detected and can be run through OCR ([tesseract.js](https://github.com/naptha/tesseract.js)).
- **Chapters & book details** — an EPUB's table of contents or a PDF's outline becomes a Contents menu in the reader (`t` toggles it; the chapter being read is marked); publisher/year appear on the shelf card. PDF figures and EPUB illustrations render inline, skipped by narration.
- **Highlights & comments** — select text or use keyboard chords to highlight in four colors; attach comments. Highlights are anchored to stable sentence IDs so they survive reloads and re-extraction.
- **Resume where you left off** — reading progress is tracked per sentence and shown as a badge on the shelf.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, React Compiler) |
| Language | TypeScript 5 |
| Database / ORM | Prisma 7 — SQLite locally, PostgreSQL in production |
| Narration | `kokoro-js` (in-browser neural TTS) |
| PDF | `unpdf` (text + geometry), `@napi-rs/canvas` (rendering) |
| EPUB | `@lingo-reader/epub-parser` + `cheerio` |
| Web articles | `@mozilla/readability` + `linkedom` |
| OCR | `tesseract.js` |
| Hosting | Railway (standalone output, persistent volume) |

## Quick start

```bash
npm install                # also runs `prisma generate`
cp .env.example .env       # defaults work as-is for local SQLite
npm run db:push            # creates dev.db from the schema (first run only)
npm run dev                # http://localhost:3000
```

That's it — no database server to install. Local dev uses a zero-setup SQLite file (`dev.db`) and stores uploaded files under `./data`. Open http://localhost:3000, drop in a PDF or EPUB, and start reading.

> **Note:** The neural voice downloads a model (~80 MB) into the browser cache on first use in the reader; subsequent loads are instant. The reader route sets cross-origin isolation headers so the voice's threaded WASM fallback works.

## Environment variables

Copy `.env.example` to `.env`. For local development the defaults are sufficient; nothing needs to be filled in.

| Variable | Purpose | Local default |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `sqlite` or `postgresql`. Selects the Prisma driver adapter and is used at build time to rewrite the schema's datasource. | `sqlite` |
| `DATABASE_URL` | Connection string. A `file:` path for SQLite, a Postgres URL in production. | `file:./dev.db` |
| `RAILWAY_VOLUME_MOUNT_PATH` | Where uploaded files and covers are stored. Injected by Railway in production; falls back to `./data` locally. | _(unset → `./data`)_ |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. **Dormant** — auth is not yet enforced (see below). | placeholder |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key. **Dormant.** | placeholder |
| `SUPABASE_SECRET_KEY` | Server-only Supabase secret. Only needed once auth is enforced. | _(unset)_ |

### A note on authentication

Auth is currently **dormant**. Every document, highlight, and comment is attributed to a single synthetic `local` user, and all routes are public. The pass-through `src/proxy.ts` (Next 16's renamed middleware) and the `User` table exist so that switching auth on later is a contained change — the `User.id` is designed to mirror a Supabase auth uid, and the Supabase client/server helpers are added when auth is switched on. Until then, treat the app as single-user.

## Documentation

- **[CLAUDE-CODING-RULES.md](./CLAUDE-CODING-RULES.md)** — coding guidelines for this repo. **All AI agents (and human contributors) must read this before making changes.**
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — system design: data model, the extraction pipeline, narration engine, highlight anchoring, reading-progress, the key user flows, and the full **HTTP API reference**.
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — how to run, verify (type-check / lint / build), the SQLite↔Postgres provider switch, the dev screenshot tool, and the push workflow.

> **For AI agents:** Before editing this codebase, read **[CLAUDE-CODING-RULES.md](./CLAUDE-CODING-RULES.md)** and follow it alongside `AGENTS.md`.

## Deployment

Audm deploys to Railway. The build flips the Prisma datasource to Postgres, generates the client, and produces a standalone Next.js build; the start command runs migrations and boots the server. See [CONTRIBUTING.md](./CONTRIBUTING.md#deployment-railway) for details.
