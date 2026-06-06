import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter. Pick by DATABASE_PROVIDER so
// the same code runs on local SQLite and Railway Postgres.
function makeAdapter() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const provider = process.env.DATABASE_PROVIDER ?? "sqlite";
  return provider === "postgresql"
    ? new PrismaPg({ connectionString: url })
    : new PrismaBetterSqlite3({ url });
}

// Reuse one client across hot-reloads in dev to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: makeAdapter() });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// The synthetic owner used before real auth is enabled. Every document /
// highlight / comment is attributed to this user until Supabase login is wired.
export const LOCAL_USER_ID = "local";

/** Ensure the placeholder local user exists (idempotent). */
export async function ensureLocalUser() {
  await prisma.user.upsert({
    where: { id: LOCAL_USER_ID },
    update: {},
    create: { id: LOCAL_USER_ID },
  });
  return LOCAL_USER_ID;
}

// Ownership-scoped lookups. Every read of a user-owned row must filter by
// LOCAL_USER_ID (today's single owner; the current user's id once auth lands) —
// these wrap that scoping so a route can't accidentally omit it. They return the
// row or null; the caller chooses its own 404 response. The optional `select` /
// `include` are forwarded to Prisma so callers keep their existing projections.

/** Find a document owned by the local user, or null. */
export function findOwnedDocument<
  T extends Omit<Prisma.DocumentFindFirstArgs, "where">,
>(id: string, args?: T) {
  return prisma.document.findFirst({
    ...args,
    where: { id, userId: LOCAL_USER_ID },
  } as Prisma.DocumentFindFirstArgs) as Promise<Prisma.DocumentGetPayload<T> | null>;
}

/** Find a highlight owned by the local user, or null. */
export function findOwnedHighlight<
  T extends Omit<Prisma.HighlightFindFirstArgs, "where">,
>(id: string, args?: T) {
  return prisma.highlight.findFirst({
    ...args,
    where: { id, userId: LOCAL_USER_ID },
  } as Prisma.HighlightFindFirstArgs) as Promise<Prisma.HighlightGetPayload<T> | null>;
}

/** Find a comment owned by the local user, or null. */
export function findOwnedComment<
  T extends Omit<Prisma.CommentFindFirstArgs, "where">,
>(id: string, args?: T) {
  return prisma.comment.findFirst({
    ...args,
    where: { id, userId: LOCAL_USER_ID },
  } as Prisma.CommentFindFirstArgs) as Promise<Prisma.CommentGetPayload<T> | null>;
}
