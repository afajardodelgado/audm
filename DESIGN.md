# Design principles

How Audm's interface decisions get made and defended. For how to run and ship
changes see [CONTRIBUTING.md](./CONTRIBUTING.md); for system design see
[ARCHITECTURE.md](./ARCHITECTURE.md); for coding conventions see
[CLAUDE-CODING-RULES.md](./CLAUDE-CODING-RULES.md).

This document grounds Audm's UI in the **Laws of UX** (Jon Yablonski). Every
notable interface choice should be justifiable by a law named below — never by
taste alone ("this looks nicer"). When you add or review UI, run it against the
[checklist](#design-review-checklist) and cite the law behind each decision.

## The house stance

Audm is **one warm, serif-driven reading room**. The reader (off-white paper,
near-black ink — `.theme-paper`) and the library (espresso, parchment, gold —
`.theme-shelf`) are two rooms of the *same* building. A visitor moving between
them should never wonder if they've left the site.

Concretely:

- **One token set.** Colours, fonts, and rhythm come from `src/app/globals.css`
  (`--espresso`, `--taupe`, `--parchment`, `--gold`, `--font-display`,
  `--font-body`, …). Don't introduce ad-hoc hex values.
- **CSS Modules only.** No Tailwind, no styled-components, no CSS-in-JS. One
  `*.module.css` per component.
- **No icon library, no UI kit.** Icons are Unicode glyphs (`‹ › ▾ ▦ ☰ ✓ ×`).
  Controls are built from React state, not Radix/headless-ui.
- **Gold is the accent, used sparingly.** It marks one thing per context — the
  active filter, the focus seam, the reading cursor. If everything is gold,
  nothing is.
- **Light only, warm always.** No dark mode; no pure white or pure black.
- **No new dependencies** for UI without a defensible reason.

## Principle → Law → Rule

Each principle states a goal, the law that backs it, and concrete rules. The
library toolbar (`LibraryToolbar.tsx`, `filterShelf.ts`, `RegisterRow.tsx`,
`Shelf.tsx`) is the worked example.

### Familiarity over novelty — *Jakob's Law*
People expect Audm to work like the apps they already use.
- Search sits **left of the filters**; the account avatar sits **far right**.
- Filters read left→right **Status · Type · Sort**; the view toggle is the
  conventional twin-glyph pair (`▦` shelf / `☰` list).
- Re-skin familiar *patterns* into the espresso idiom — don't reinvent the
  interaction. Deviate only with a defensible user benefit.

### Reachable, generous targets — *Fitts's Law*
- Interactive controls are **≥44×44px** (pad small glyphs to reach it).
- List rows are **full-row tap targets** (the whole row is the `Link`).
- Keep **≥8px** between adjacent controls to prevent mis-taps.

### Few, sequenced choices — *Hick's Law*
- Keep menus short (Status 5, Type 5, Sort 4).
- Reveal add-forms on demand (**progressive disclosure** — the inline
  add-drawer), don't stack every form on the page.
- Pre-select a sensible default (Sort = *Newest first*).

### Chunk the controls — *Miller's Law*
- The toolbar groups into *identity · search · add · filters · view · account*
  so it scans as a handful of clusters, not a dozen loose buttons. Chunk; don't
  cap counts at an arbitrary "7".

### Accept messy input — *Postel's Law*
- Search is **case-insensitive substring over title + author**, trimmed,
  partial-matching; empty query shows everything (`matchesQuery`).

### Design the peak and the end — *Peak–End Rule*
- The **peak** is the 3D shelf — keep it the hero; new chrome never demotes it.
- End flows gracefully: a no-results state offers **Clear filters** rather than
  a dead end; adds land the item on the shelf with visible feedback.

### Polish is functional — *Aesthetic–Usability Effect*
- Reuse the high-polish token system — but verify polish isn't hiding a broken
  core task (search actually filters, the toggle actually switches, the reader
  still opens). E.g. a started book must read "1% read", never "580 min read".

### One thing stands out, not by colour alone — *Von Restorff Effect*
- Exactly one primary emphasis per context (active filter, the avatar's gold
  rim).
- Signal state with **border/weight/position + a glyph**, never colour alone —
  the active menu item carries a gold left-seam **and** a `✓` (colour-vision
  safe). Respect `prefers-reduced-motion`.

### Absorb complexity for the user — *Tesler's Law*
- The system does the filtering/sorting/derivation. The processing **poll runs
  over the full document list**, never the filtered view, so a filter can never
  silently stall a still-extracting upload.

### Respond instantly — *Doherty Threshold (<400ms)*
- Search/filter/sort run **client-side over already-loaded data** — instant, no
  spinner.
- Adds are **optimistic** (`handleUploaded` prepends, then polling reconciles).
- The add-drawer transition is quick and is **skipped under reduced-motion**.

### Ethics — serve the user's goals
- No dark patterns: destructive remove keeps an explicit confirm step; no fake
  urgency, no forced or hard-to-exit flows; **Clear filters** is always
  available.
- Design beyond the happy path — handle empty library, filtered-to-nothing,
  in-flight processing, and failed extraction states.

## Design-review checklist

Run any screen or flow against these (cite the law on any flag):

- [ ] Follows familiar conventions? *(Jakob)*
- [ ] Targets big, spaced, reachable (≥44px, full-row where sensible)? *(Fitts)*
- [ ] Choices minimised and sequenced at each decision point? *(Hick)*
- [ ] Controls chunked into meaningful groups? *(Miller)*
- [ ] Input accepted liberally with clear feedback? *(Postel)*
- [ ] Peak moment and ending intentionally designed? *(Peak–End)*
- [ ] Visual quality high — and not masking a broken core task? *(Aesthetic–Usability)*
- [ ] The one key element distinct, and not by colour alone? *(Von Restorff)*
- [ ] System absorbs complexity instead of dumping it on the user? *(Tesler)*
- [ ] Responds within ~400ms or shows perceived progress? *(Doherty)*
- [ ] Serves the user's goals — no dark patterns, edge cases handled? *(Ethics)*
