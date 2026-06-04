// Rewrites the Prisma datasource provider to match DATABASE_PROVIDER.
// Local dev keeps "sqlite" (the committed default); Railway sets
// DATABASE_PROVIDER=postgresql so this flips it before generate/migrate.
import { readFileSync, writeFileSync } from "node:fs";

const provider = process.env.DATABASE_PROVIDER ?? "sqlite";
if (!["sqlite", "postgresql"].includes(provider)) {
  console.error(`set-db-provider: unsupported DATABASE_PROVIDER "${provider}"`);
  process.exit(1);
}

const path = new URL("../prisma/schema.prisma", import.meta.url);
const schema = readFileSync(path, "utf8");
const next = schema.replace(
  /provider = "(sqlite|postgresql)"/,
  `provider = "${provider}"`
);

if (next !== schema) {
  writeFileSync(path, next);
  console.log(`set-db-provider: datasource provider -> ${provider}`);
} else {
  console.log(`set-db-provider: provider already ${provider}`);
}
