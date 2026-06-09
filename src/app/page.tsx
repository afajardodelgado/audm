import { prisma, LOCAL_USER_ID } from "@/lib/db";
import Shelf from "@/components/library/Shelf";
import { bookFromMeta } from "@/lib/types";

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
      meta: true,
    },
  });

  // Serialize dates and derive the imprint fields; meta itself (which carries
  // the full EPUB table of contents) never ships to the client.
  const initial = documents.map(({ meta, ...d }) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
    ...bookFromMeta(meta),
  }));

  return <Shelf initial={initial} />;
}
