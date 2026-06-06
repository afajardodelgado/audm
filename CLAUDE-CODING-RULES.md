# CLAUDE-CODING-RULES

Behavioral guidelines to reduce common LLM coding mistakes in this repo. Merge with the project instructions in `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, and `CONTRIBUTING.md`.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

> Example — "Add export for a document": clarify scope (full text vs. highlights?), shape (download, API JSON, or file on the volume?), and which fields, before writing anything. "Make the reader faster" could mean narration latency, scroll smoothness, or extraction time — name the options and pick with the user.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

> ❌ A `DiscountStrategy` class hierarchy for one calculation.
> ✅ One function until a second case actually exists.
>
> In this codebase that means: don't add a generic "repository layer" or config system for a query used once. Reach for the existing shared helpers instead of inventing new ones — `findOwned*` (`src/lib/db.ts`), `normalizeWhitespace`/`countBlocksWords`/`splitSentences` (`src/lib/extract/segment.ts`), `parseSid` (`src/lib/anchor.ts`), `postForDocument` (`src/lib/api.ts`), the limits in `src/lib/constants.ts`.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style (single quotes? semicolons? the route-handler shape with `await params`?), even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

> ❌ Fixing "empty `documentId` crashes the highlights route" but also rewriting validation, adding fields, and reformatting the file.
> ✅ Change only the lines that handle the empty/invalid `documentId`.
>
> ❌ Adding logging to `extractDocument` while switching quote style, adding type annotations, and reflowing whitespace.
> ✅ Add the log lines; leave everything else byte-for-byte.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Turn tasks into verifiable goals:
- "Add validation" → "Exercise the invalid inputs (curl / a test), then make them pass."
- "Fix the bug" → "Reproduce it first, then make the repro pass."
- "Refactor X" → "Confirm behavior before and after — `tsc`, `npm run build`, and a smoke test of the touched routes."

For multi-step tasks, state a brief plan, each step independently verifiable:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently; weak ones ("make it work") force constant clarification. In this repo, "verify" almost always includes `npx tsc --noEmit`, `npm run build`, and — for behavior — hitting the JSON API with `curl` or capturing `node scripts/screenshot.mjs` (see [CONTRIBUTING.md](./CONTRIBUTING.md)). Note `npm run lint` is noisy because of `src/generated`; compare against baseline rather than the raw count.

---

## Anti-patterns summary

| Principle | Anti-pattern | Fix |
| --- | --- | --- |
| Think first | Silently assumes scope, fields, format | List assumptions, ask |
| Simplicity | A pattern/abstraction for a single use | One function until complexity is real |
| Surgical | Reformats / adds types while fixing a bug | Change only the lines that fix it |
| Goal-driven | "I'll review and improve it" | "Reproduce → fix → verify no regressions" |

**Key insight:** the overcomplicated version isn't obviously wrong — it follows real patterns. The problem is **timing**: complexity added before it's needed is harder to read, test, and change. Good code solves today's problem simply, not tomorrow's prematurely.

**These guidelines are working if:** diffs contain fewer unnecessary changes, fewer rewrites from overcomplication, and clarifying questions come before implementation rather than after mistakes.
