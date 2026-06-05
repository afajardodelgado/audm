import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { createWorker } from "tesseract.js";
import type { ExtractResult } from "./types";
import { textToBlocks } from "./text";
import { countWords } from "./segment";

// Rasterize at 2x so small body text survives OCR; higher scales cost time/RAM.
const RENDER_SCALE = 2;

// unpdf renders PDF pages with @napi-rs/canvas (prebuilt native, no Cairo build).
// Passing the import explicitly avoids relying on unpdf's runtime auto-detection.
const canvasImport = () =>
  import("@napi-rs/canvas") as Promise<typeof import("@napi-rs/canvas")>;

/**
 * OCR a scanned PDF: render each page to a PNG, recognize text with a single
 * reused tesseract.js worker, and assemble the recognized text into paragraph
 * blocks. Slow (~1-5s/page) — callers run this fire-and-forget off the request.
 */
export async function runOcr(data: Buffer, numPagesHint: number): Promise<ExtractResult> {
  const uint8 = new Uint8Array(data);

  // Resolve the page count if the caller didn't have one cached in meta.
  let numPages = numPagesHint;
  if (!numPages) {
    const pdf = await getDocumentProxy(uint8);
    numPages = pdf.numPages;
  }

  const worker = await createWorker("eng");
  const pageTexts: string[] = [];
  try {
    for (let p = 1; p <= numPages; p++) {
      let png: ArrayBuffer;
      try {
        png = await renderPageAsImage(uint8, p, { scale: RENDER_SCALE, canvasImport });
      } catch {
        continue; // skip a page that fails to render rather than aborting
      }
      const { data: result } = await worker.recognize(Buffer.from(png));
      const text = result.text.trim();
      if (text) pageTexts.push(text);
    }
  } finally {
    await worker.terminate();
  }

  // Join pages with a blank line so textToBlocks() treats page breaks as
  // paragraph boundaries.
  const blocks = textToBlocks(pageTexts.join("\n\n"));
  const wordCount = blocks.reduce((n, b) => n + countWords(b.text), 0);

  return {
    title: "",
    blocks,
    wordCount,
    meta: { numPages, ocr: true },
    needsOcr: false,
  };
}
