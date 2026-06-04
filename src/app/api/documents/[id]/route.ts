import { NextRequest, NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID } from "@/lib/db";
import { deleteStoredFile } from "@/lib/storage";

export const runtime = "nodejs";

// Full document + ordered blocks (for the reader). Highlights load separately.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await prisma.document.findFirst({
    where: { id, userId: LOCAL_USER_ID },
    include: { blocks: { orderBy: { index: "asc" } } },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ document });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await prisma.document.findFirst({
    where: { id, userId: LOCAL_USER_ID },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await deleteStoredFile(doc.filePath);
  await prisma.document.delete({ where: { id } }); // cascades blocks/highlights
  return NextResponse.json({ ok: true });
}
