import { NextRequest, NextResponse } from "next/server";
import { LOCAL_USER_ID, findOwnedDocument } from "@/lib/db";
import { coverPathFor, readStoredFile, sniffImageType } from "@/lib/storage";

export const runtime = "nodejs";

// Serve a document's generated cover thumbnail (PNG). 404 when the document has
// no cover so the shelf falls back to the text card.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await findOwnedDocument(id, { select: { hasCover: true } });
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
