/**
 * Solace — loading `.env.local` for command-line tools.
 *
 * Next.js loads `.env.local` automatically, so the dashboard never needs this.
 * The Hardhat config, the deploy script and the seed script are plain Node
 * processes and do not get that for free.
 *
 * This is a deliberately small parser rather than a dependency. It handles the
 * subset of the format we actually use — `KEY=value`, comments, blank lines and
 * optional surrounding quotes — and does nothing clever. A fuller
 * implementation would buy us nothing here and would be one more thing to
 * install on a laptop in a building with restricted wifi.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Files to read, in order. Later files do not override earlier ones. */
const ENV_FILES = [".env.local", ".env"] as const;

/**
 * Parse the contents of an env file.
 *
 * Exported so it can be tested without touching the filesystem.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();

    // Skip blank lines and comments.
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (key === "") continue;

    let value = line.slice(separator + 1).trim();

    // Strip one layer of matching quotes, if present.
    const isQuoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (isQuoted) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

/**
 * Load `.env.local` (then `.env`) into `process.env`.
 *
 * Real environment variables always win: anything already set in the process is
 * left untouched. That keeps `SOLACE_MODE=LIVE npm run deploy` working as
 * anyone would expect.
 *
 * Missing files are not an error. A fresh checkout with no `.env.local` must
 * still run.
 */
export function loadEnvFiles(rootDir: string = process.cwd()): void {
  for (const fileName of ENV_FILES) {
    const filePath = path.join(rootDir, fileName);
    if (!existsSync(filePath)) continue;

    let parsed: Record<string, string>;
    try {
      parsed = parseEnvFile(readFileSync(filePath, "utf8"));
    } catch {
      // An unreadable env file should not stop the tool from running with
      // whatever is already in the environment.
      continue;
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
