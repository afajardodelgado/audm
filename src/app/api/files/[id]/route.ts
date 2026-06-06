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
  const data = await readStoredFile(doc.filePath);
  const type =
    doc.sourceType === "pdf" ? "application/pdf" : "application/epub+zip";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="${doc.id}.${doc.sourceType}"`,
    },
  });
}
