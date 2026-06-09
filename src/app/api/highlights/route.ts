import { NextRequest, NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID, ensureLocalUser, findOwnedDocument } from "@/lib/db";
import { HL_COLORS } from "@/lib/anchor";

export const runtime = "nodejs";

// GET /api/highlights?documentId=... — all highlights (with comments) for a doc.
export async function GET(req: NextRequest) {
  const documentId = req.nextUrl.searchParams.get("documentId");
  if (!documentId) {
    return NextResponse.json({ error: "documentId required." }, { status: 400 });
  }
  const highlights = await prisma.highlight.findMany({
    where: { documentId, userId: LOCAL_USER_ID },
    orderBy: { createdAt: "asc" },
    include: { comments: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({ highlights });
}

// POST — create a highlight (optionally with an initial comment body).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const {
    documentId,
    startSid,
    endSid,
    startOffset,
    endOffset,
    exactText,
    prefix = "",
    suffix = "",
    color = "yellow",
    comment,
  } = body ?? {};

  if (
    !documentId ||
    typeof startSid !== "string" ||
    typeof endSid !== "string" ||
    typeof startOffset !== "number" ||
    typeof endOffset !== "number" ||
    typeof exactText !== "string" ||
    !(HL_COLORS as readonly string[]).includes(color)
  ) {
    return NextResponse.json({ error: "Invalid highlight." }, { status: 400 });
  }

  // Scope the parent lookup to the owner so a highlight can never be attached
  // to someone else's document (the create below trusts this id).
  const doc = await findOwnedDocument(documentId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const userId = await ensureLocalUser();
  const highlight = await prisma.highlight.create({
    data: {
      documentId,
      userId,
      startSid,
      endSid,
      startOffset,
      endOffset,
      exactText,
      prefix,
      suffix,
      color,
      comments:
        comment && comment.trim()
          ? { create: { userId, body: comment.trim() } }
          : undefined,
    },
    include: { comments: true },
  });

  return NextResponse.json({ highlight }, { status: 201 });
}
