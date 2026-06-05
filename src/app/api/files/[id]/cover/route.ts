import { NextRequest, NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID } from "@/lib/db";
import { coverPathFor, readStoredFile } from "@/lib/storage";

export const runtime = "nodejs";

// Serve a document's generated cover thumbnail (PNG). 404 when the document has
// no cover so the shelf falls back to the text card.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await prisma.document.findFirst({
    where: { id, userId: LOCAL_USER_ID },
    select: { hasCover: true },
  });
  if (!doc?.hasCover) {
    return NextResponse.json({ error: "No cover." }, { status: 404 });
  }
  try {
    const data = await readStoredFile(coverPathFor(LOCAL_USER_ID, id));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": sniffImageType(data),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Cover missing." }, { status: 404 });
  }
}

// Covers are stored verbatim (PNG from PDF rendering, JPEG/PNG/etc. from EPUBs),
// so report the real type from the file's magic bytes.
function sniffImageType(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (buf.length >= 4 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (buf.length >= 6 && buf.toString("ascii", 0, 6).startsWith("GIF8"))
    return "image/gif";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return "application/octet-stream";
}
