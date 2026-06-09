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
  try {
    const meta = epub.getMetadata();
    title = meta.title?.trim() ?? "";
    const creator = meta.creator?.[0];
    if (creator) author = (creator.contributor ?? "").toString().trim() || undefined;
  } catch {
    /* metadata optional */
  }

  const spine = epub.getSpine();
  const walked: ExtractedBlock[] = [];

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
    walked.push(...htmlToBlocks(chapter.html, { images: true }));
  }

  // Materialize image blocks while the parser's extracted resources are still
  // on disk: read each image's bytes (loadChapter rewrote <img src> to absolute
  // paths in resourceDir), keep only real raster figures, and carry the bytes
  // on the block to persistResult, which knows the document identity and saves
  // them on the volume. A block that fails any step is dropped so the final
  // block indexes stay contiguous — the asset filename embeds that final index
  // plus a content hash (so immutable-cached URLs can't go stale).
  const blocks: ExtractedBlock[] = [];
  for (const b of walked) {
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
    meta: { chapters: spine.length },
    needsOcr: false,
    coverImage,
  };
}

// A short non-crypto id for the per-extraction temp dir.
function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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
