import { NextRequest, NextResponse } from "next/server";
import { findOwnedDocument } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";

export const runtime = "nodejs";

// Stream the original uploaded file from the volume. (User files must NOT live
// under /public — that is build-time static — so they are served here.)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await findOwnedDocument(id);
  if (!doc) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  let data: Buffer;
  try {
    data = await readStoredFile(doc.filePath);
  } catch {
    // The row exists but its file is gone from the volume (e.g. storage was
    // wiped or never persistent) — a missing resource, not a server fault.
    return NextResponse.json({ error: "File missing from storage." }, { status: 404 });
  }
  const type =
    doc.sourceType === "pdf" ? "application/pdf" : "application/epub+zip";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="${doc.id}.${doc.sourceType}"`,
    },
  });
}
