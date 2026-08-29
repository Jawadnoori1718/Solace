/**
 * Solace — canonical hashing of engine inputs and outputs.
 *
 * "The engine is reproducible" is a claim, and a claim needs a test. These
 * digests are that test: run the engine twice over the same input and both
 * digests must match, byte for byte. Store them alongside a run and anyone can
 * later check that a published decision came from the input it claims to.
 *
 * `JSON.stringify` alone will not do. It preserves whatever key order the
 * object happened to be built in, so two structurally identical inputs can
 * serialise differently and hash differently. Canonicalising the key order
 * first removes that, and makes the digest a property of the data rather than
 * of the code path that assembled it.
 */

import { createHash } from "node:crypto";

/**
 * Serialise a value with object keys in sorted order, at every depth.
 *
 * Array order is preserved, because in this system array order is meaningful —
 * the sequence of allocation decisions is part of what is being attested to.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    // Floating point needs care. -0 and 0 are different values to
    // Object.is but the same number to everyone else, and JSON renders them
    // differently, so a digest could differ over a sign nobody can see.
    if (typeof value === "number" && Object.is(value, -0)) return 0;
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const result: Record<string, unknown> = {};
  for (const [key, nested] of entries) {
    result[key] = canonicalise(nested);
  }
  return result;
}

/** SHA-256 of the canonical serialisation, as a hex string. */
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
