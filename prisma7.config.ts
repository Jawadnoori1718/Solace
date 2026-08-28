import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration.
 *
 * The database URL is resolved here rather than read from a `.env` file, and
 * that is a deliberate reliability choice. The demo database is a local SQLite
 * file with a fixed path; it holds no secrets and its location does not vary by
 * environment. Hardcoding it removes an entire class of "it worked on my
 * machine" failure — there is exactly one database file, and the CLI and the
 * running app cannot disagree about where it is.
 *
 * `DATABASE_URL` is still honoured if it is genuinely set in the process
 * environment, so pointing at a scratch database stays possible.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./prisma/solace.db",
  },
});
