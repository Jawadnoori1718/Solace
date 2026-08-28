/**
 * Solace — the database client.
 *
 * One SQLite file, one path, resolved from the project root at runtime. The
 * path is computed rather than read from the environment so that the Prisma CLI
 * and the running application cannot end up pointing at different databases —
 * a failure that is quiet, confusing, and exactly the sort of thing that ruins
 * a live demonstration.
 *
 * Prisma 7 connects through a driver adapter rather than a bundled query
 * engine, so the SQLite driver is wired up explicitly below.
 */

import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
// A relative, fully-specified import rather than the `@/` alias. Command-line
// tools — the Hardhat deploy script, the seed script, the engine tests — run as
// plain Node processes with no bundler to resolve path aliases for them.
import { PrismaClient } from "../generated/prisma/client.ts";

/** Absolute path to the SQLite file backing the demo. */
export const DATABASE_FILE = path.join(process.cwd(), "prisma", "solace.db");

const datasourceUrl = process.env.DATABASE_URL ?? `file:${DATABASE_FILE}`;

/**
 * Next.js reloads server modules on every edit in development. Without a
 * global cache that would open a new database connection on each reload until
 * SQLite refused to open any more.
 */
const globalForPrisma = globalThis as unknown as {
  solacePrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: datasourceUrl });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.solacePrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.solacePrisma = prisma;
}
