import { PrismaClient } from "@/generated/prisma/client";
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
