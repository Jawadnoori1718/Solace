/**
 * Solace — load `.env.local` before anything else evaluates.
 *
 * Import this FIRST, above every other import, in any command-line entry point.
 *
 * WHY THIS FILE EXISTS
 *
 * Calling `loadEnvFiles()` in a script's body looks like it works and does not.
 * ES module imports are evaluated before the importing module's own statements
 * run, so by the time the call happens, `config.ts` has already read
 * `process.env` and captured its values — every one of them empty.
 *
 * The symptom was quiet and expensive: scripts ignored `.env.local` entirely
 * and fell back to defaults, while the Next.js server (which loads env files
 * before any application module evaluates) used the real values. The two halves
 * of the system disagreed about their own configuration, and nothing said so.
 *
 * A bare side-effecting import placed first is the only ordering the module
 * system guarantees.
 */

import { loadEnvFiles } from "./env-file.ts";

loadEnvFiles();
