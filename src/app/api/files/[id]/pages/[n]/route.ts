import { NextRequest, NextResponse } from "next/server";
import { LOCAL_USER_ID, findOwnedDocument } from "@/lib/db";
import {
  pagePathFor,
  readStoredFile,
  saveFile,
} from "@/lib/storage";

export const runtime = "nodejs";

// Rendered width for original-page images — crisp on a ~800px reading column
// at 2x. The render scale derives from each page's own width.
const TARGET_PAGE_WIDTH = 1600;

// Serve one rendered page of the original PDF (the source of the "Original"
// reader view). Pages render on first request and are cached on the volume —
// a document's file never changes, so the result is immutable.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> }
) {
  const { id, n } = await params;
  const pageNumber = Number(n);
  const doc = await findOwnedDocument(id, {
    select: { sourceType: true, filePath: true, meta: true },
  });
  if (!doc || doc.sourceType !== "pdf") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const meta = doc.meta as { numPages?: number } | null;
  const numPages = Number(meta?.numPages) || 0;
  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > numPages
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const cached = pagePathFor(LOCAL_USER_ID, id, pageNumber);
  let png: Buffer;
  try {
    png = await readStoredFile(cached);
  } catch {
    // No cached render — render from the source PDF. A missing source file
    // (storage wiped / never persistent) is a 404, not a render failure.
    let file: Buffer;
    try {
      file = await readStoredFile(doc.filePath);
    } catch {
      return NextResponse.json({ error: "File missing from storage." }, { status: 404 });
    }
    try {
      const { renderPageAsImage } = await import("unpdf");
      const rendered = await renderPageAsImage(
        new Uint8Array(file),
        pageNumber,
        {
          canvasImport: () =>
            import("@napi-rs/canvas") as Promise<typeof import("@napi-rs/canvas")>,
          width: TARGET_PAGE_WIDTH,
        }
      );
      png = Buffer.from(rendered);
      // Cache best-effort — a failed write just means re-rendering next time.
      await saveFile(cached, png).catch(() => {});
    } catch {
      return NextResponse.json({ error: "Page render failed." }, { status: 500 });
    }
  }

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
