import { NextRequest, NextResponse } from "next/server";
import { prisma, ensureLocalUser, findOwnedHighlight } from "@/lib/db";

export const runtime = "nodejs";

// POST — add a comment to an existing highlight.
export async function POST(req: NextRequest) {
  const { highlightId, body } = (await req.json()) ?? {};
  if (!highlightId || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "highlightId and body required." }, { status: 400 });
  }
  const hl = await findOwnedHighlight(highlightId);
  if (!hl) {
    return NextResponse.json({ error: "Highlight not found." }, { status: 404 });
  }
  const userId = await ensureLocalUser();
  const comment = await prisma.comment.create({
    data: { highlightId, userId, body: body.trim() },
  });
  return NextResponse.json({ comment }, { status: 201 });
}
