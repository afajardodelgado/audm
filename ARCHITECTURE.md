# Architecture

This document describes how Audm is put together: the directory layout, the data model, the document-extraction pipeline, the narration engine, highlight anchoring, reading-progress tracking, the main user flows, and the HTTP API. It reflects the app **as it is today** (single-user, auth dormant); where a design choice exists to enable future auth, that's called out.

For setup and workflow, see [CONTRIBUTING.md](./CONTRIBUTING.md). For a feature overview, see [README.md](./README.md).

---

## Directory map

```
src/
├── app/                          # Next.js App Router: pages + API routes
│   ├── page.tsx                  # Home — the library "shelf"
│   ├── layout.tsx                # Root layout, fonts, metadata
│   ├── globals.css               # CSS custom properties + base typography
│   ├── read/[docId]/page.tsx     # Reader page (server component → <Reader/>)
│   ├── login/                    # Login stub (auth dormant)
│   ├── shortcuts/                # Keyboard-shortcut reference page
│   └── api/                      # Request handlers (see API reference below)
│       ├── documents/route.ts            # GET list
│       ├── documents/[id]/route.ts       # GET one / PATCH progress / DELETE
│       ├── documents/[id]/ocr/route.ts   # POST run OCR
│       ├── upload/route.ts               # POST file upload (PDF/EPUB)
│       ├── import/route.ts               # POST text/URL import
│       ├── highlights/route.ts           # GET list / POST create
│       ├── highlights/[id]/route.ts      # PATCH color / DELETE
│       ├── comments/route.ts             # POST add comment
│       ├── comments/[id]/route.ts        # PATCH body / DELETE
│       ├── files/[id]/route.ts           # GET original file stream
│       ├── files/[id]/cover/route.ts     # GET cover thumbnail
│       ├── files/[id]/images/[asset]/route.ts # GET inline image asset (PDF/EPUB figures)
│       └── files/[id]/pages/[n]/route.ts # GET rendered PDF page (Original view; cached on first render)
│
├── components/
│   ├── library/                  # Shelf UI (styles: Shelf.module.css, shared by the group)
│   │   ├── Shelf.tsx             # Library view; polls for status while extracting
│   │   ├── LibraryToolbar.tsx    # Search · add · Status/Type/Sort filters · view toggle
│   │   ├── filterShelf.ts        # Filter/sort options + the pure shelf-filtering logic
│   │   ├── FlipCard.tsx          # One book card (cover, status, actions)
│   │   ├── RegisterRow.tsx       # One list-view ("register") row
│   │   ├── bindings.ts           # Deterministic book-cloth colour binding per document
│   │   ├── UploadDropzone.tsx    # Drag-drop file upload → /api/upload
│   │   └── ImportPanel.tsx       # Paste-text / URL import → /api/import
│   └── reader/                   # Reader UI (styles: Reader.module.css, shared by the group)
│       ├── Reader.tsx            # Orchestrator: views, scroll, narration, highlights, chords
│       ├── BlockRenderer.tsx     # Renders a block with per-sentence data-sid spans
│       ├── ContentsMenu.tsx      # Table-of-contents dropdown (PDF outline / EPUB TOC)
│       ├── PdfOriginal.tsx       # "Original" view: source pages + projected overlays
│       ├── useBookPaging.ts      # "Book" view: CSS-multicolumn two-page spreads
│       ├── ProgressRail.tsx      # Visual reading-progress bar
│       ├── CommentPopover.tsx    # Add-comment popover
│       ├── CommentOverlay.tsx    # Comment markers/overlay
│       ├── useScrollEngine.ts    # rAF auto-scroll at a WPM multiplier
│       ├── useCurrentLine.ts     # IntersectionObserver → "current" sentence
│       ├── useHighlights.ts      # CSS Custom Highlight API integration
│       └── useNarrator.ts        # React wrapper around the narrator engine
│
├── lib/
│   ├── db.ts                     # Prisma singleton, LOCAL_USER_ID, ownership guards
│   ├── types.ts                  # Client-facing shapes (dates as ISO strings)
│   ├── constants.ts              # Cross-cutting limits/tunables
│   ├── api.ts                    # Client fetch helpers (postForDocument, normalizeDoc)
│   ├── storage.ts                # File I/O on the volume (save/read/delete, path helpers)
│   ├── anchor.ts                 # Highlight anchoring + sid parsing + chord targets
│   ├── extract/                  # Document → Blocks pipeline (see below)
│   │   ├── index.ts              # extractDocument / extractDocumentOcr / persistResult
│   │   ├── types.ts              # ExtractResult, ExtractedBlock
│   │   ├── pdf.ts / epub.ts / text.ts / url.ts / ocr.ts
│   │   ├── segment.ts            # Intl.Segmenter sentence/word splitting + shared text utils
│   │   └── cover.ts              # Cover-image generation
│   ├── narrator/
│   │   ├── types.ts              # NarratorEngine interface + state types
│   │   └── KokoroNarrator.ts     # In-browser neural TTS implementation
│   └── (no auth client yet)      # Auth dormant; Supabase client added when enabled
│
├── proxy.ts                      # Pass-through today (Next 16 proxy, formerly middleware.ts); auth refresh goes here later
├── instrumentation.ts            # Boot hook: fails documents stranded mid-extraction by a restart
└── generated/prisma/             # Generated Prisma client (do not edit / lint)
```

---

## Data model

Defined in [`prisma/schema.prisma`](./prisma/schema.prisma). Five models:

```
User 1──* Document 1──* Block
              │
              1──* Highlight 1──* Comment
```

- **User** — placeholder owner. Pre-auth, everything belongs to the synthetic `local` user; once Supabase auth is enabled, `id` mirrors the auth uid. Cascades to documents/highlights/comments.
- **Document** — one imported source. Key fields: `sourceType` (`pdf|epub|text|web`), `filePath` (on the volume), `fileHash` (sha256, dedupe/cache key), `status` (lifecycle below), `wordCount`, `meta` (JSON), `lastReadSid` + `readingProgress` (progress), `hasCover`. Indexed on `userId` and `fileHash`. `meta` contents by source: PDFs `{ numPages, strippedLines, toc?, book? }` (+ `ocr: true` after OCR); EPUBs `{ chapters, toc?, book? }`. `toc` is `[{ label, block, depth }]` — entries anchored to the chapter's first block index, built from the EPUB NCX (nav-doc-only EPUB3 books have none) or the PDF outline (destinations resolved to pages, pages to blocks). `book` is `{ language?, publisher?, description?, year? }` (PDFs: no publisher; year from CreationDate, description from Subject). Text/web `{ kind, url? }`. The shelf list derives `publisher`/`year` server-side (`bookFromMeta`) — the full `meta` JSON never ships to the client; the reader page parses `toc` via `tocFromMeta`.
- **Block** — one paragraph / heading / blockquote / listitem / image in reading order. `index` is 0-based; `(documentId, index)` is unique. `text` is normalized plain text; `sentenceCount` is computed at extraction time. **There is no Sentence table** — sentences are derived deterministically at render time (see anchoring). **Image blocks** (EPUB figures) carry `src` (asset filename `{index}-{sha8}.{ext}` under the document's `{docId}.img` volume dir), probed `width`/`height` for layout reservation, alt/caption text in `text`, and always `sentenceCount: 0` — they render no sentence spans, so narration, the current-line observer, and highlights skip them.
- **Highlight** — a W3C-style anchor: `startSid`/`endSid` (`"blockIndex:sentenceIndex"`), `startOffset`/`endOffset`, `exactText`, and `prefix`/`suffix` (~32 chars of context for fuzzy re-anchoring), plus `color`.
- **Comment** — free text attached to a highlight.

### Document status lifecycle

```
pending ──► extracting ──► ready          (normal success)
                       └──► failed         (no text / parse error)
                       └──► ocr_needed     (PDF with no text layer)

ocr_needed ──► ocr_running ──► ready       (user triggers OCR)
                          └──► failed
```

The shelf polls `GET /api/documents` while any document is in a non-terminal state and updates the card when it reaches `ready`/`failed`. Because extraction runs fire-and-forget in the server process, a restart mid-run would strand a document in a non-terminal status forever — so at boot `src/instrumentation.ts` marks any `pending`/`extracting`/`ocr_running` documents `failed` with a retry message.

### Database access

`src/lib/db.ts` exports a single cached `PrismaClient` (reused across dev hot-reloads). The driver adapter is chosen at runtime from `DATABASE_PROVIDER`: `PrismaBetterSqlite3` for SQLite, `PrismaPg` for Postgres. The schema is kept portable (no Postgres-only column types); at build time `scripts/set-db-provider.mjs` rewrites the single `provider = "..."` line to match.

**Ownership guards.** Every read of a user-owned row must be scoped to the owner. `db.ts` provides `findOwnedDocument`, `findOwnedHighlight`, and `findOwnedComment` — thin wrappers that apply the `userId: LOCAL_USER_ID` filter (and forward optional `select`/`include`) and return the row or `null`. API routes use these so the ownership scoping can't be accidentally omitted. (Background extraction in `extract/index.ts` looks rows up by primary key without this scoping, since it runs off a known document id rather than a user request.)

---

## Extraction pipeline (`src/lib/extract/`)

The job of extraction is: **source bytes → ordered, sentence-counted `Block`s → `status: ready`.**

**Entry points** (`index.ts`):
- `extractDocument(documentId)` — for uploaded files. Sets `extracting`, reads the file, runs the format-specific parser, then either flags `ocr_needed`, records `failed`, or persists. Fire-and-forget after upload.
- `extractDocumentOcr(documentId)` — for scanned PDFs. Sets `ocr_running`, OCRs, persists. Slow (seconds/page); fire-and-forget.
- `persistResult(documentId, doc, result)` — shared tail used by every path: in one transaction it deletes existing blocks and inserts the new ones (computing `sentenceCount` per block via `splitSentences`), saves the cover (best-effort), and flips the document to `ready` with fresh metadata.

**Format parsers**, each producing an `ExtractResult` (`{ title, author?, blocks, wordCount, meta, needsOcr, coverImage? }`):
- **`pdf.ts`** — `unpdf` text runs → glyph-geometry line reconstruction → paragraph inference (gap/indent heuristics, de-hyphenation), with running-head/footer and page-number stripping. PDFs over `MAX_PDF_PAGES` are refused up front (per-page work is the resource-exhaustion vector). If there's essentially no text layer it returns `needsOcr: true` (checked before any image work). Otherwise a second pass walks each page's operator list for **embedded raster images**: the CTM is tracked for vertical placement, pixels (RGBA/RGB/1-bit gray) are encoded via `@napi-rs/canvas` (JPEG for large opaque photos, else PNG), spacer-size images are dropped, hashes recurring across pages are dropped as decoration (the image counterpart of running heads), and survivors join the page's lines as pseudo-lines so they land between the right paragraphs. The **PDF outline** is resolved (destination → page → first block on-or-after that page) into `meta.toc`, sharing the EPUB builder's finalize tail; Info-dictionary metadata lands in `meta.book`. Generates a cover from page 1.
- **`epub.ts`** — `@lingo-reader/epub-parser` for spine (reading order) + metadata; each chapter's HTML is walked by `htmlToBlocks` (cheerio) into paragraph/heading/blockquote/listitem blocks — plus, for EPUBs only (`{ images: true }`), inline **image blocks**: each `<img>` is read from the parser's extracted resources, kept if it's a real raster figure (jpeg/png/gif/webp, not a tiny spacer; SVG skipped), content-hashed, dimension-probed, and carried as bytes to `persistResult`, which writes the assets under `{docId}.img/` on the volume. The EPUB **table of contents** is mapped to blocks at the same time: per-spine-item start indexes are recorded during the walk, remapped past dropped image blocks, and each NCX entry is resolved (`resolveHref`) to its chapter's first block → `meta.toc`. Book metadata (language/publisher/description/year) lands in `meta.book`. Reads the cover from the EPUB manifest — EPUB3 `properties="cover-image"` first, then the EPUB2 `<meta name="cover">` declaration, then name heuristics.
- **`text.ts`** — `textToBlocks` splits pasted text on blank lines into paragraphs; `textToResult` wraps it. Also used as the OCR text assembler.
- **`url.ts`** — fetches the page, runs Mozilla Readability over a `linkedom` DOM, then reuses `htmlToBlocks` on the cleaned article (falling back to plain text). Returns the cleaned source text so it can be stored.
- **`ocr.ts`** — parses the PDF once into a shared `PDFDocumentProxy`, renders each page to a PNG (`@napi-rs/canvas`) and recognizes text with a single reused tesseract.js worker, then assembles via `textToBlocks`. (The proxy must be shared: pdf.js detaches the byte buffer on first load, so per-page byte parsing would silently fail after page 1.)

**Shared text utilities** live in `segment.ts` and are used by every parser:
- `splitSentences(text)` — `Intl.Segmenter` sentence segmentation, post-merged at common abbreviations ("Mr.", "Dr.", initials) so a period after an abbreviation doesn't false-split. Crucially, `splitSentences(text).join(" ")` is stable, which keeps highlight anchors valid.
- `countWords(text)` / `countBlocksWords(blocks)` — word counts.
- `normalizeWhitespace(text)` — the single canonical whitespace collapse used everywhere block text is produced.

---

## Narration (`src/lib/narrator/`)

Narration runs **entirely in the browser**. `NarratorEngine` (`types.ts`) is the interface; `KokoroNarrator.ts` is the implementation, wrapped for React by `useNarrator.ts`.

- **Model** — `onnx-community/Kokoro-82M-v1.0-ONNX` via `kokoro-js`. Device is auto-detected: WebGPU (fp32) when available, otherwise threaded WASM (q8). The model is downloaded once and cached by the browser; the engine is a module singleton so it survives reader remounts.
- **Voices** — the model ships ~28 American/British voices; `VoiceMenu.tsx` (toolbar, ♪) lists them grouped by accent once the model is ready. The chosen voice and playback rate persist in `localStorage` (`audm:voice`, `audm:rate`, global — listener preferences, not document state) and are restored on reader mount; a mid-play voice change re-speaks the current sentence in the new voice.
- **Cross-origin isolation** — `next.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` **scoped to `/read/*`**, which enables `SharedArrayBuffer` for the threaded WASM fallback. Scoping limits the blast radius of `require-corp`.
- **Word-level read-along** — Kokoro returns no per-word timestamps, so the engine estimates them: it splits the sentence and distributes the audio clip's duration across words by length, emitting a `WordRange` (sid + char offsets) on a rAF timer. The reader paints that range with the CSS Custom Highlight API (`::highlight(tts-word)`).
- **Smooth playback** — sentences are synthesized a couple ahead (prefetch buffer) and played through an `HTMLAudioElement`, so speed changes use native `playbackRate` without re-synthesis.

When the narrator is speaking it is the clock: it drives the active-sentence highlight and the page scrolls to follow. When it isn't, the scroll observer (`useCurrentLine`) drives the highlight. Exactly one driver at a time.

---

## Highlight anchoring (`src/lib/anchor.ts`)

Highlights must survive reloads and even re-extraction without storing live DOM nodes, so Audm follows the W3C Web Annotation **TextQuote + TextPosition** pattern.

- **Sentence IDs.** Every sentence span the reader renders carries `data-sid="blockIndex:sentenceIndex"`. Because both the server (at extraction, for `sentenceCount`) and the client (at render) run the **same** `Intl.Segmenter` logic, the boundaries — and therefore the IDs — match. `parseSid(sid)` parses an id into `{ block, sentence }`.
- **Anchor shape.** `buildAnchor(...)` records `startSid`/`endSid`, the char offsets, the `exactText`, and `prefix`/`suffix` context.
- **Resolution.** `resolveAnchor(...)` maps an anchor back to DOM `Range`s (one per sentence it spans) for `new Highlight(...)`. If the text changed and a sid no longer resolves, the prefix/suffix enable a fuzzy fallback.
- **Rendering.** Highlights are painted with the **CSS Custom Highlight API** (`CSS.highlights.set("hl-yellow", ...)`), never by mutating the DOM — this preserves the single-text-node-per-span invariant that anchoring relies on. Where the API is unavailable, highlights persist in the DB but don't paint.
- **Chord targets.** `rangeForTarget(...)` computes the span range for keyboard-chord highlights (current sentence, whole paragraph, or extending one back).

---

## Reading progress

Two fields on `Document`, both **monotonic** (they never move backward):
- `lastReadSid` — the furthest sentence reached.
- `readingProgress` — a 0..1 fraction, shown as the shelf badge.

`Reader.tsx` maps the active sid to a fraction using precomputed cumulative per-block sentence offsets (O(1) per lookup), tracks the max seen this session, throttles `PATCH /api/documents/[id]` to one write per `PROGRESS_SAVE_THROTTLE_MS`, and flushes on `pagehide` via `navigator.sendBeacon` (which survives a closing tab where `fetch` may be cancelled). Because `sendBeacon` can only issue POST, the route aliases POST to the same PATCH handler. The server only writes when the incoming fraction is strictly greater than the stored one.

---

## Key user flows

**Import a file (PDF/EPUB).** `UploadDropzone` → `postForDocument("/api/upload", FormData)` → route validates size/type, hashes, creates the `Document` (`pending`), saves the file, and `await extractDocument(id)` inline → returns the document. The shelf polls until it's `ready`.

**Import text / URL.** `ImportPanel` → `postForDocument("/api/import", json)` → route parses text (`textToResult`) or fetches+extracts a URL (`urlToResult`), creates the document, stores the source, and `persistResult`s inline → `ready` immediately.

**Read & narrate.** Click a book → `/read/[docId]` server-renders the document + blocks + highlights into `<Reader>`. The reader wires up `useScrollEngine`, `useCurrentLine`, `useHighlights`, and `useNarrator`. Space toggles play (narration if supported, else auto-scroll); clicking a sentence starts narration there; ↑/↓ change speed. Books with a table of contents (EPUB NCX / PDF outline) get a **Contents** menu in the top bar (`t` toggles; the chapter being read carries the gold seam) — selecting a chapter scrolls to it, or redirects narration there when it's already speaking.

**Reading views.** `v` (or the top-right toggle) switches presentation; the Audm article stays mounted in every view because narration units and chord anchors are built from its spans. **Original** (PDFs with stored geometry): `PdfOriginal.tsx` lazy-loads server-rendered page images (`/api/files/[id]/pages/[n]`, rendered once and cached on the volume) and projects the experience onto them — the active-sentence band, the narration word mark, and saved highlights are placed by mapping char ranges proportionally across each block's stored line rects (`Block.layout`: `[[page, x, yBaseline, width, fontHeight, chars], …]`, page sizes in `meta.pages`); clicks resolve to the nearest line's sentence and start narration there, and the viewport-centre sentence is reported back so chords/progress keep working. Narration follow tracks the spoken WORD: same-page drift recenters stepwise past a threshold, but a page crossing recenters immediately — a sentence that began at the foot of one page pulls the view to the next page the moment the voice crosses. Deliberately approximate (no per-glyph metrics) — the Speechify-style trade. **Book** (EPUBs): the same article flows into fixed-height CSS columns (the epub.js/Readium pagination technique) shown two to a spread; turns are manual (←/→, edge buttons) or automatic (narration follow at word granularity — a sentence that continues onto the next spread turns the page the moment the voice crosses the boundary; the silent fallback turns at the WPM pace). Comments follow the highlight into every view: margin cards beside the article (Audm) or the source page (Original), and compact tap-to-expand markers in Book view (the spread leaves no margin for cards; off-spread comments surface when their spread is shown). Highlights paint everywhere.

**Highlight & comment.** Chord `c` then `s` (sentence) / `p` (paragraph) — or `c d s`/`c d p` to extend one back — creates a highlight in the active color (`1`–`4` pick the color; `x`/Backspace removes the highlight under the current sentence). Creating one offers a comment popover (`POST /api/comments`).

---

## HTTP API reference

All routes run on the Node.js runtime. Success/error bodies are JSON unless noted. There is no auth today; all rows are scoped to the `local` user server-side.

### Documents

| Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/documents` | — | `200 { documents: DocumentSummary[] }` (newest first) | — |
| GET | `/api/documents/[id]` | — | `200 { document: Document & { blocks: Block[] } }` (blocks ordered) | `404` not found |
| PATCH | `/api/documents/[id]` | `{ lastReadSid?: string, readingProgress: number }` | `200 { ok: true, readingProgress }` (monotonic — lower values are accepted but ignored). POST is an alias for the reader's `sendBeacon` flush. | `400` invalid body · `404` not found |
| DELETE | `/api/documents/[id]` | — | `200 { ok: true }` (cascades blocks/highlights/comments; deletes file + cover) | `404` not found |
| POST | `/api/documents/[id]/ocr` | — | `202 { status: "ocr_running" }` (fire-and-forget) | `400` not a PDF · `404` not found · `409` not awaiting OCR |

### Import & upload

| Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| POST | `/api/upload` | `multipart/form-data` with `file` (PDF/EPUB) | `201 { document }` | `400` no file · `413` too large (> `MAX_UPLOAD_BYTES`, 80 MB) · `415` unsupported type |
| POST | `/api/import` | `{ kind: "text", title?, text }` or `{ kind: "url", title?, url }` | `201 { document }` | `400` empty/invalid/unknown kind · `413` text too long (> `MAX_TEXT_CHARS`) · `422` no readable text · `502` fetch/extract failed |

### Highlights & comments

| Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/highlights?documentId=…` | — | `200 { highlights: (Highlight & { comments })[] }` | `400` missing `documentId` |
| POST | `/api/highlights` | `{ documentId, startSid, endSid, startOffset, endOffset, exactText, prefix?, suffix?, color?, comment? }` | `201 { highlight }` (optional `comment` creates the first comment) | `400` invalid (incl. unknown `color`) · `404` document not found |
| PATCH | `/api/highlights/[id]` | `{ color }` | `200 { highlight }` | `400` invalid color · `404` not found |
| DELETE | `/api/highlights/[id]` | — | `200 { ok: true }` (cascades comments) | `404` not found |
| POST | `/api/comments` | `{ highlightId, body }` | `201 { comment }` | `400` missing fields · `404` highlight not found |
| PATCH | `/api/comments/[id]` | `{ body }` | `200 { comment }` | `400` empty body · `404` not found |
| DELETE | `/api/comments/[id]` | — | `200 { ok: true }` | `404` not found |

### Files

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| GET | `/api/files/[id]` | `200` original file stream (`application/pdf` or `application/epub+zip`) | `404` not found |
| GET | `/api/files/[id]/cover` | `200` cover image (type sniffed from magic bytes; cached immutably) | `404` no cover |
| GET | `/api/files/[id]/images/[asset]` | `200` inline image asset (type sniffed; cached immutably — the filename embeds a content hash) | `404` unknown document / malformed asset name / missing file |
| GET | `/api/files/[id]/pages/[n]` | `200` rendered PDF page PNG (rendered on first request, cached on the volume; immutable) | `404` not a PDF / page out of range · `500` render failed |

`DocumentSummary` / `Block` / `Highlight` / `Comment` client shapes are in [`src/lib/types.ts`](./src/lib/types.ts) (dates as ISO strings).
