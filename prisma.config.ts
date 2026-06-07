import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7: the migration/CLI connection URL lives here, not in schema.prisma.
// DATABASE_URL is SQLite locally ("file:./dev.db") and Postgres on Railway.
//
// Read process.env directly rather than the env() helper: env() throws if the
// var is unset, which breaks `prisma generate` during the build/install phase
// (postinstall) on Railway, where DATABASE_URL is only injected at deploy time.
// generate doesn't need a URL; migrate deploy + runtime supply the real one.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
