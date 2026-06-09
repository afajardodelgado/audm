import { NextRequest, NextResponse } from "next/server";
import { prisma, findOwnedHighlight } from "@/lib/db";
import { HL_COLORS } from "@/lib/anchor";

export const runtime = "nodejs";

// PATCH — change a highlight's color.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { color } = (await req.json().catch(() => null)) ?? {};
  if (!(HL_COLORS as readonly string[]).includes(color)) {
    return NextResponse.json({ error: "Invalid color." }, { status: 400 });
  }
  const existing = await findOwnedHighlight(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const highlight = await prisma.highlight.update({
    where: { id },
    data: { color },
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
  const existing = await findOwnedHighlight(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await prisma.highlight.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
