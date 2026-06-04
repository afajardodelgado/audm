import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: the migration/CLI connection URL lives here, not in schema.prisma.
// DATABASE_URL is SQLite locally ("file:./dev.db") and Postgres on Railway.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
