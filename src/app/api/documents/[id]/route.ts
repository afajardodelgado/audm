import { NextRequest, NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID, findOwnedDocument } from "@/lib/db";
import {
  deleteStoredFile,
  deleteStoredDir,
  coverPathFor,
  imageDirFor,
  pageDirFor,
} from "@/lib/storage";

export const runtime = "nodejs";

// Full document + ordered blocks (for the reader). Highlights load separately.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await findOwnedDocument(id, {
    include: { blocks: { orderBy: { index: "asc" } } },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ document });
}

// Persist reading progress. Monotonic: progress only ever moves forward, so
// scrolling back or reopening near the top never erases how far you've read.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { lastReadSid?: string; readingProgress?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const doc = await findOwnedDocument(id, {
    select: { readingProgress: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const incoming = Number(body.readingProgress);
  if (!Number.isFinite(incoming) || incoming <= doc.readingProgress) {
    // Not further than before — accept silently without a write.
    return NextResponse.json({ ok: true, readingProgress: doc.readingProgress });
  }

  const readingProgress = Math.min(1, Math.max(0, incoming));
  await prisma.document.update({
    where: { id },
    data: {
      readingProgress,
      lastReadSid: body.lastReadSid ?? undefined,
    },
  });
  return NextResponse.json({ ok: true, readingProgress });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await findOwnedDocument(id);
  if (!doc) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await deleteStoredFile(doc.filePath);
  if (doc.hasCover) await deleteStoredFile(coverPathFor(LOCAL_USER_ID, id));
  await deleteStoredDir(imageDirFor(LOCAL_USER_ID, id)); // inline image assets
  await deleteStoredDir(pageDirFor(LOCAL_USER_ID, id)); // rendered page cache
  await prisma.document.delete({ where: { id } }); // cascades blocks/highlights
  return NextResponse.json({ ok: true });
}
