import { initEpubFile } from "@lingo-reader/epub-parser";
import * as cheerio from "cheerio";
import type { ExtractResult, ExtractedBlock } from "./types";
import { countWords } from "./segment";

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

/**
 * Extract paragraph-segmented blocks from an EPUB. EPUB is already reflowable
 * XHTML, so reading order comes from the OPF <spine> (NOT the TOC or filenames)
 * and we simply walk block-level elements per chapter, dropping all CSS/layout.
 */
export async function extractEpub(data: Buffer): Promise<ExtractResult> {
  const epub = await initEpubFile(new Uint8Array(data));

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
  const blocks: ExtractedBlock[] = [];

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
    blocks.push(...htmlToBlocks(chapter.html));
  }

  epub.destroy?.();

  const wordCount = blocks.reduce((n, b) => n + countWords(b.text), 0);

  return {
    title,
    author,
    blocks,
    wordCount,
    meta: { chapters: spine.length },
    needsOcr: false,
  };
}

function htmlToBlocks(html: string): ExtractedBlock[] {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, figure, img, svg").remove();

  const out: ExtractedBlock[] = [];
  const selector = Array.from(BLOCK_TAGS).join(",");

  $(selector).each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "p";
    // Skip a block that only wraps other block elements (avoid double-counting).
    const $el = $(el);
    if ($el.children(Array.from(BLOCK_TAGS).join(",")).length > 0) return;

    const text = $el.text().replace(/\s+/g, " ").trim();
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
