/**
 * Solace — the privacy boundary.
 *
 * This module is the only place a household reference becomes an on-chain
 * identifier, and it exists so that boundary is a single reviewable file rather
 * than a convention people are trusted to follow.
 *
 * THE THREAT WE ARE DEFENDING AGAINST
 *
 * A council pilot covers a small, enumerable set of households. If we wrote a
 * plain SHA-256 of a household reference to a public chain, anyone could
 * compute the hash of every candidate reference — "REC-01", "REC-02", and so on
 * up to a few thousand — and match them against the chain in under a second.
 * The hash would be reversible in practice, and the privacy claim would be
 * false.
 *
 * A keyed HMAC under a secret salt breaks that attack. Without the salt an
 * attacker cannot compute the hash of a candidate reference at all, so the
 * enumeration has nothing to compare against. The salt lives in `.env.local`,
 * is never committed, and never leaves the server.
 *
 * WHAT THIS MEANS IN PRACTICE
 *
 * The chain holds a quantity of energy, an amount, a timestamp, a pot
 * reference, and an opaque 32-byte value. Reversing that value back to a
 * household requires the salt, which only the council holds. Names, addresses,
 * benefit status, health conditions and household composition never leave the
 * local database, because they are never passed to a contract call.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { RECIPIENT_HASH_SALT } from "./config.ts";

/**
 * Compute the on-chain identifier for a household reference.
 *
 * Returns a `0x`-prefixed 32-byte hex string, which is exactly the `bytes32`
 * the `settle()` function expects.
 *
 * @param reference An internal household reference such as "REC-03".
 * @param salt      Override the deployment salt. Only tests should pass this.
 */
export function recipientHash(
  reference: string,
  salt: string = RECIPIENT_HASH_SALT,
): `0x${string}` {
  const digest = createHmac("sha256", salt)
    .update(`solace:household:${reference}`)
    .digest("hex");

  return `0x${digest}`;
}

/**
 * Check whether a hash corresponds to a reference.
 *
 * Uses a constant-time comparison. The timing of this check should not leak
 * information about how much of a guessed reference was correct.
 */
export function matchesRecipientHash(
  reference: string,
  hash: string,
  salt: string = RECIPIENT_HASH_SALT,
): boolean {
  const expected = recipientHash(reference, salt);
  if (expected.length !== hash.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
}

/**
 * The namespaced pot identifier written on chain.
 *
 * Pot references are public by design — a councillor should be able to quote
 * "WINTER-2026" in a committee — so this is a plain hash with no salt. It is
 * hashed rather than passed as a string only because `bytes32` is cheaper and
 * fixed-width on chain.
 */
export function potReferenceHash(reference: string): `0x${string}` {
  const digest = createHmac("sha256", "solace:pot")
    .update(reference)
    .digest("hex");

  return `0x${digest}`;
}
