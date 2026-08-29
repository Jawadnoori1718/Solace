/**
 * Solace — the Anthropic client, and the boundary around it.
 *
 * A language model does exactly two jobs in this system:
 *
 *   1. Reading a council officer's free-text case note and turning it into a
 *      structured need signal, once, which is then persisted.
 *   2. Turning ledger figures that ordinary code has already computed into the
 *      plain English a councillor could take to a scrutiny committee.
 *
 * It interprets inputs and describes outcomes. It does not decide who receives
 * energy, it is never called during allocation, and the allocation engine has
 * no path to reach it — `src/lib/engine/` imports nothing from this directory,
 * which is a property anyone can check with a grep.
 *
 * Nothing here throws when the key is missing. An unconfigured system falls
 * back to whatever it has already stored and says so.
 */

import Anthropic from "@anthropic-ai/sdk";

import { ANTHROPIC_API_KEY, hasAnthropicKey } from "../config.ts";

/**
 * The model used for both jobs.
 *
 * The original brief named `claude-sonnet-4-6`, which has since been
 * superseded; `claude-sonnet-5` is the current Sonnet. Overridable so a
 * reviewer can substitute their own without touching code.
 */
export const AI_MODEL = process.env.SOLACE_AI_MODEL?.trim() || "claude-sonnet-5";

/**
 * Bumped whenever a prompt or an output schema changes.
 *
 * Stored against every parsed need signal, so a score produced by an older
 * prompt is identifiable rather than silently trusted. Without this, changing a
 * prompt would quietly change the meaning of numbers already in the database.
 */
export const PARSER_VERSION = "need-parser-1.0.0";

let cached: Anthropic | null = null;

/** The client, or null when no key is configured. */
export function anthropic(): Anthropic | null {
  if (!hasAnthropicKey) return null;
  cached ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return cached;
}

/** Why an AI call could not be made, phrased for display. */
export const NO_KEY_MESSAGE =
  "No Anthropic API key is configured, so this could not be generated. Set ANTHROPIC_API_KEY in .env.local.";

/** Turn an SDK error into something worth showing a person. */
export function describeAiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "The Anthropic API is rate limiting this key. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The request was rejected: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API. Check the network connection, or run in demo mode.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status ?? ""}: ${error.message}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}
