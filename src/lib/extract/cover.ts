import { renderPageAsImage } from "unpdf";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Cover thumbnails. PDFs render page 1; EPUBs use their declared cover image
// (when present). Both return PNG/image bytes, or null when no cover is
// available — callers fall back to the plain text card.

const COVER_SCALE = 1.5; // enough detail for a shelf thumbnail, small on disk

const canvasImport = () =>
  import("@napi-rs/canvas") as Promise<typeof import("@napi-rs/canvas")>;

/** Render the first page of a PDF to a PNG buffer (the de-facto cover). */
export async function generatePdfCover(data: Buffer): Promise<Buffer | null> {
  try {
    const png = await renderPageAsImage(new Uint8Array(data), 1, {
      scale: COVER_SCALE,
      canvasImport,
    });
    return Buffer.from(png);
  } catch {
    return null; // cover is best-effort
  }
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

/**
 * Read an EPUB's cover IMAGE bytes. getCoverImage() returns an XHTML wrapper
 * page (not the image) for many EPUBs, so instead we scan the manifest for an
 * image item that looks like the cover (EPUB3 properties="cover-image", or an
 * id/href containing "cover"). The parser writes every manifest resource to
 * `resourceSaveDir` at init, naming each file `href.replace(/\//g,"_")` — so we
 * rebuild that on-disk path and read it. Returns null when no cover image
 * exists (caller falls back to the text card).
 *
 * `epub` is the initEpubFile() instance; call this before epub.destroy() while
 * the extracted resources are still on disk.
 */
export async function generateEpubCover(
  epub: {
    getManifest: () => Record<string, ManifestItem>;
    getMetadata: () => { metas?: Record<string, string> };
  },
  resourceSaveDir: string
): Promise<Buffer | null> {
  try {
    const items = Object.values(epub.getManifest());
    const images = items.filter((m) => /^image\//i.test(m.mediaType));
    if (!images.length) return null;
    // EPUB2 declares the cover as <meta name="cover" content="manifest-id">.
    const coverId = epub.getMetadata().metas?.["cover"];
    const cover =
      images.find((m) => (m.properties ?? "").includes("cover-image")) ??
      (coverId
        ? images.find((m) => m.id === coverId || m.href === coverId)
        : undefined) ??
      images.find((m) => /(^|[_\-/])cover/i.test(m.href) || /cover/i.test(m.id)) ??
      images[0]; // last resort: the first image in the book
    const onDisk = resolve(resourceSaveDir, cover.href.replace(/\//g, "_"));
    return await readFile(onDisk);
  } catch {
    return null;
  }
}
