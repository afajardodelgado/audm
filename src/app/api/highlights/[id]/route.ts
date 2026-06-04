import { NextRequest, NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID } from "@/lib/db";

export const runtime = "nodejs";

// PATCH — change a highlight's color.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { color } = (await req.json()) ?? {};
  const existing = await prisma.highlight.findFirst({
    where: { id, userId: LOCAL_USER_ID },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const highlight = await prisma.highlight.update({
    where: { id },
    data: { color: typeof color === "string" ? color : existing.color },
    include: { comments: true },
  });
  return NextResponse.json({ highlight });
}

// DELETE — remove a highlight (cascades its comments).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.highlight.findFirst({
    where: { id, userId: LOCAL_USER_ID },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await prisma.highlight.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
