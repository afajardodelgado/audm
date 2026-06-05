import { prisma, LOCAL_USER_ID } from "@/lib/db";
import Shelf from "@/components/library/Shelf";

export const dynamic = "force-dynamic";

export default async function Home() {
  const documents = await prisma.document.findMany({
    where: { userId: LOCAL_USER_ID },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      author: true,
      sourceType: true,
      status: true,
      wordCount: true,
      readingProgress: true,
      hasCover: true,
      createdAt: true,
    },
  });

  // Serialize dates for the client component.
  const initial = documents.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
  }));

  return <Shelf initial={initial} />;
}
