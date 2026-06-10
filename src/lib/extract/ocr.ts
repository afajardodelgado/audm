import {
  createIsomorphicCanvasFactory,
  getDocumentProxy,
  renderPageAsImage,
} from "unpdf";
import { createWorker } from "tesseract.js";
import type { ExtractResult } from "./types";
import { textToBlocks } from "./text";
import { countBlocksWords } from "./segment";
import { MAX_PDF_PAGES } from "@/lib/constants";

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
export async function runOcr(data: Buffer): Promise<ExtractResult> {
  const uint8 = new Uint8Array(data);

  // Parse the document ONCE and render every page from the shared proxy.
  // Handing renderPageAsImage raw bytes per page wouldn't just re-parse the
  // whole file each time — pdf.js detaches the byte buffer on first load, so
  // every page after the first would fail to render and the run would
  // silently keep only page 1's text. The CanvasFactory must be supplied at
  // document init (pdf.js v4 uses it for internal temporary canvases).
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  const pdf = await getDocumentProxy(uint8, { CanvasFactory });
  // Defensive cap — extraction refuses over-cap PDFs before they can reach
  // ocr_needed, but documents flagged before that guard existed may linger.
  const numPages = Math.min(pdf.numPages, MAX_PDF_PAGES);

  const worker = await createWorker("eng");
  const pageTexts: string[] = [];
  try {
    for (let p = 1; p <= numPages; p++) {
      let png: ArrayBuffer;
      try {
        png = await renderPageAsImage(pdf, p, { scale: RENDER_SCALE, canvasImport });
      } catch {
        continue; // skip a page that fails to render rather than aborting
      }
      const { data: result } = await worker.recognize(Buffer.from(png));
      const text = result.text.trim();
      if (text) pageTexts.push(text);
    }
  } finally {
    await worker.terminate();
    // unpdf never destroys documents it's handed — the proxy is ours to free.
    await pdf.destroy().catch(() => {});
  }

  // Join pages with a blank line so textToBlocks() treats page breaks as
  // paragraph boundaries.
  const blocks = textToBlocks(pageTexts.join("\n\n"));
  const wordCount = countBlocksWords(blocks);

  return {
    title: "",
    blocks,
    wordCount,
    meta: { numPages, ocr: true },
    needsOcr: false,
  };
}
