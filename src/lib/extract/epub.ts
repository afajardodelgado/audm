import { initEpubFile } from "@lingo-reader/epub-parser";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import type { ExtractResult, ExtractedBlock } from "./types";
import { countBlocksWords, normalizeWhitespace } from "./segment";
import { generateEpubCover } from "./cover";
import { sniffImageType } from "@/lib/storage";

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
]);

// Inline-image guards: drop spacer/ornament images (1-px gifs, flourishes)
// while keeping real figures.
const MIN_IMAGE_BYTES = 1024;
const MIN_IMAGE_DIM = 24; // px, applied only when dimensions could be probed

// Served asset extension per sniffed type; anything else (notably SVG, which is
// unsniffable XML and an XSS risk if served for direct navigation) is dropped.
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Extract paragraph-segmented blocks from an EPUB. EPUB is already reflowable
 * XHTML, so reading order comes from the OPF <spine> (NOT the TOC or filenames)
 * and we simply walk block-level elements per chapter, dropping all CSS/layout.
 */
export async function extractEpub(data: Buffer): Promise<ExtractResult> {
  // Give the parser an isolated temp dir for the resources it extracts to disk
  // (cover image, etc.) instead of its default "./images" under cwd. We read the
  // cover from here, then remove the dir.
  const resourceDir = join(tmpdir(), `audm-epub-${randomId()}`);
  const epub = await initEpubFile(new Uint8Array(data), resourceDir);

  let title = "";
  let author: string | undefined;
  let book: BookInfo | undefined;
  try {
    const meta = epub.getMetadata();
    title = meta.title?.trim() ?? "";
    const creator = meta.creator?.[0];
    if (creator) author = (creator.contributor ?? "").toString().trim() || undefined;
    book = bookInfo(meta);
  } catch {
    /* metadata optional */
  }

  const spine = epub.getSpine();
  const walked: ExtractedBlock[] = [];
  // Each spine item's first block index in `walked` — pre-materialization.
  // Non-linear, unloadable, and empty chapters are simply never recorded, so
  // TOC entries pointing at them drop out naturally.
  const chapterStarts: { id: string; start: number }[] = [];

  for (const item of spine) {
    // linear="no" items are supplementary (e.g. cover art) — skip.
    if (item.linear === "no") continue;
    let chapter;
    try {
      chapter = await epub.loadChapter(item.id);
    } catch {
      continue;
    }
    if (!chapter?.html) continue;
    const chapterBlocks = htmlToBlocks(chapter.html, { images: true });
    if (!chapterBlocks.length) continue;
    chapterStarts.push({ id: item.id, start: walked.length });
    walked.push(...chapterBlocks);
  }

  // Materialize image blocks while the parser's extracted resources are still
  // on disk: read each image's bytes (loadChapter rewrote <img src> to absolute
  // paths in resourceDir), keep only real raster figures, and carry the bytes
  // on the block to persistResult, which knows the document identity and saves
  // them on the volume. A block that fails any step is dropped so the final
  // block indexes stay contiguous — the asset filename embeds that final index
  // plus a content hash (so immutable-cached URLs can't go stale).
  const blocks: ExtractedBlock[] = [];
  // walkedToFinal[w] = the final index of the first SURVIVING block at-or-after
  // walked index w — remaps chapter starts past any dropped image blocks.
  const walkedToFinal: number[] = [];
  for (const b of walked) {
    walkedToFinal.push(blocks.length);
    if (b.type !== "image") {
      blocks.push(b);
      continue;
    }
    if (!b.src) continue;
    let data: Buffer;
    try {
      data = await readFile(b.src);
    } catch {
      continue; // resource missing from the archive — drop the block
    }
    const ext = IMAGE_EXT[sniffImageType(data)];
    if (!ext || data.length < MIN_IMAGE_BYTES) continue;
    let width: number | undefined;
    let height: number | undefined;
    try {
      const { loadImage } = await import("@napi-rs/canvas");
      const img = await loadImage(data);
      width = img.width;
      height = img.height;
      if (Math.min(width, height) < MIN_IMAGE_DIM) continue;
    } catch {
      /* dimensions are a layout hint only — keep the image without them */
    }
    const sha8 = createHash("sha256").update(data).digest("hex").slice(0, 8);
    blocks.push({
      type: "image",
      text: b.text,
      src: `${blocks.length}-${sha8}.${ext}`,
      width,
      height,
      data,
    });
  }

  walkedToFinal.push(blocks.length); // end sentinel

  // Map the book's table of contents onto final block indexes (needs the live
  // parser for getToc/resolveHref, so it runs before destroy()).
  const toc = buildEpubToc(epub, chapterStarts, walkedToFinal, blocks.length);

  // Read the cover while the parser's extracted resources are still on disk.
  const coverImage = (await generateEpubCover(epub, resourceDir)) ?? undefined;

  epub.destroy?.();
  // Best-effort cleanup of the temp resource dir.
  await rm(resourceDir, { recursive: true, force: true }).catch(() => {});

  const wordCount = countBlocksWords(blocks);

  return {
    title,
    author,
    blocks,
    wordCount,
    meta: {
      chapters: spine.length,
      ...(toc ? { toc } : {}),
      ...(book ? { book } : {}),
    },
    needsOcr: false,
    coverImage,
  };
}

// A short non-crypto id for the per-extraction temp dir.
function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

type EpubFile = Awaited<ReturnType<typeof initEpubFile>>;

// Table-of-contents guards: cap label length and total entries so one
// pathological book can't bloat Document.meta or the contents menu. Shared
// with the PDF outline builder (pdf.ts), like htmlToBlocks is with url.ts.
export const TOC_LABEL_MAX = 120;
const MAX_TOC_ENTRIES = 500;

/** Shared tail for TOC builders (EPUB nav, PDF outline): order by block,
 *  keep the first entry per block (the chapter-level entry beats fragment
 *  children), cap the count, and only return a list worth a menu (≥ 2). */
export function finalizeToc(
  entries: { label: string; block: number; depth: number }[]
): { label: string; block: number; depth: number }[] | undefined {
  entries.sort((a, b) => a.block - b.block); // stable — document order kept per block
  const deduped = entries.filter(
    (e, i) => i === 0 || e.block !== entries[i - 1].block
  );
  const capped = deduped.slice(0, MAX_TOC_ENTRIES);
  return capped.length >= 2 ? capped : undefined;
}

interface TocPoint {
  label: string;
  href: string;
  children?: TocPoint[];
}

/**
 * Map the EPUB's table of contents (NCX navMap — the parser doesn't read the
 * EPUB3 nav doc, so nav-only books yield none and the reader hides the menu)
 * onto final block indexes. Chapter starts were recorded against
 * pre-materialization "walked" indexes; walkedToFinal remaps them past dropped
 * image blocks. Entries are flattened with depth capped at 1, resolved to
 * their spine item via resolveHref, deduped to one per block (the
 * chapter-level entry wins over its fragment children), and only a list of 2+
 * is worth a menu.
 */
function buildEpubToc(
  epub: EpubFile,
  chapterStarts: { id: string; start: number }[],
  walkedToFinal: number[],
  totalBlocks: number
): { label: string; block: number; depth: number }[] | undefined {
  // A chapter empty after materialization can't anchor an entry.
  const startById = new Map<string, number>();
  for (let i = 0; i < chapterStarts.length; i++) {
    const start = walkedToFinal[chapterStarts[i].start];
    const next =
      i + 1 < chapterStarts.length
        ? walkedToFinal[chapterStarts[i + 1].start]
        : totalBlocks;
    if (start < next) startById.set(chapterStarts[i].id, start);
  }

  const out: { label: string; block: number; depth: number }[] = [];
  const visit = (points: TocPoint[], depth: number) => {
    for (const p of points) {
      const label = normalizeWhitespace(p.label ?? "").slice(0, TOC_LABEL_MAX);
      if (label) {
        let block: number | undefined;
        try {
          const resolved = epub.resolveHref(p.href);
          if (resolved) block = startById.get(resolved.id);
        } catch {
          /* unresolvable entry — skip it */
        }
        if (block !== undefined && block < totalBlocks) {
          out.push({ label, block, depth: Math.min(depth, 1) });
        }
      }
      if (p.children?.length) visit(p.children, depth + 1);
    }
  };
  try {
    visit(epub.getToc() ?? [], 0);
  } catch {
    return undefined;
  }

  return finalizeToc(out);
}

const DESCRIPTION_MAX = 600;

// A type alias (not an interface) so it satisfies Prisma's InputJsonValue,
// which requires an implicit index signature.
type BookInfo = {
  language?: string;
  publisher?: string;
  description?: string;
  year?: number;
};

// Publisher descriptions often arrive with embedded markup and numeric
// entities (sometimes double-encoded); flatten to clean prose and cap it.
function cleanDescription(raw: string): string {
  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return normalizeWhitespace(text).slice(0, DESCRIPTION_MAX);
}

// First plausible publication year across the metadata's date fields. Never
// dcterms:modified — that's the file's revision date, not the book's.
function publicationYear(meta: {
  date?: Record<string, string>;
  metas?: Record<string, string>;
}): number | undefined {
  const candidates = [
    meta.date?.publication,
    ...Object.values(meta.date ?? {}),
    meta.metas?.["dcterms:date"],
    meta.metas?.["dcterms:issued"],
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const m = c.match(/\b(\d{4})\b/);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/** The book-level metadata worth keeping on Document.meta (all optional). */
function bookInfo(meta: ReturnType<EpubFile["getMetadata"]>): BookInfo | undefined {
  const language =
    typeof meta.language === "string" ? meta.language.trim() : "";
  const publisher =
    typeof meta.publisher === "string" ? meta.publisher.trim() : "";
  const description =
    typeof meta.description === "string" ? cleanDescription(meta.description) : "";
  const year = publicationYear(meta);
  if (!language && !publisher && !description && !year) return undefined;
  return {
    ...(language ? { language } : {}),
    ...(publisher ? { publisher } : {}),
    ...(description ? { description } : {}),
    ...(year ? { year } : {}),
  };
}

export function htmlToBlocks(
  html: string,
  opts?: { images?: boolean }
): ExtractedBlock[] {
  const $ = cheerio.load(html);
  // With images on (EPUB chapters), keep <figure>/<img> in the tree and walk
  // <img> as a block — and keep <header>, which in book XHTML is sectioning
  // content wrapping the chapter title (an <h1> we must not lose). On web
  // imports <header> is site chrome, so it stays stripped there along with
  // figures/images. <svg> always goes.
  $(
    opts?.images
      ? "script, style, nav, footer, svg"
      : "script, style, nav, header, footer, figure, img, svg"
  ).remove();

  const out: ExtractedBlock[] = [];
  const selector =
    Array.from(BLOCK_TAGS).join(",") + (opts?.images ? ",img" : "");

  $(selector).each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "p";
    const $el = $(el);

    if (tag === "img") {
      // Emit an image block carrying the parser-rewritten absolute temp path;
      // extractEpub materializes it (reads bytes, sniffs, hashes) afterwards.
      // The alt — falling back to the wrapping figure's caption — rides on
      // `text` and is rendered as the <img alt>, never as sentence spans.
      const src = $el.attr("src");
      if (!src) return;
      const alt =
        normalizeWhitespace($el.attr("alt") ?? "") ||
        normalizeWhitespace($el.closest("figure").find("figcaption").text());
      out.push({ type: "image", text: alt, src });
      return;
    }

    // A figcaption's text already rides on its image block as the alt; don't
    // also emit it as a paragraph. (Only reachable with images on — otherwise
    // the whole <figure> was removed above.)
    if (opts?.images && $el.closest("figcaption").length > 0) return;

    // Skip a block that only wraps other block elements (avoid double-counting).
    if ($el.children(Array.from(BLOCK_TAGS).join(",")).length > 0) return;

    const text = normalizeWhitespace($el.text());
    if (!text) return;

    if (/^h[1-6]$/.test(tag)) {
      out.push({ type: "heading", level: Number(tag[1]), text });
    } else if (tag === "blockquote") {
      out.push({ type: "blockquote", text });
    } else if (tag === "li") {
      out.push({ type: "listitem", text });
    } else {
      out.push({ type: "paragraph", text });
    }
  });

  return out;
}
