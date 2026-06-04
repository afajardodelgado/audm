import { NextRequest, NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID } from "@/lib/db";

export const runtime = "nodejs";

// PATCH — edit a comment's body.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { body } = (await req.json()) ?? {};
  if (typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "body required." }, { status: 400 });
  }
  const existing = await prisma.comment.findFirst({
    where: { id, userId: LOCAL_USER_ID },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const comment = await prisma.comment.update({
    where: { id },
    data: { body: body.trim() },
  });
  return NextResponse.json({ comment });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.comment.findFirst({
    where: { id, userId: LOCAL_USER_ID },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await prisma.comment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
