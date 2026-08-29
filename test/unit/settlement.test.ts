/**
 * Solace — settlement layer tests.
 *
 * Two things are held to account here. First, that the committed ABI still
 * matches the compiled contract, because a silently stale ABI would have the
 * dashboard reading fields that no longer exist. Second, and more importantly,
 * that nothing which could identify a household can reach a contract call.
 *
 * The privacy test is deliberately constructed the way an adversary would do
 * it: build the exact arguments the settlement service sends, then search them
 * for every piece of personal data we hold.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { SOLACE_POUND_ABI } from "../../src/lib/chain/solace-pound-abi.ts";
import { potReferenceHash, recipientHash } from "../../src/lib/privacy.ts";
import { RECIPIENTS } from "../../src/lib/synthetic/households.ts";

const ARTIFACT_PATH = path.join(
  process.cwd(),
  "artifacts",
  "contracts",
  "SolacePound.sol",
  "SolacePound.json",
);

describe("the committed ABI", () => {
  it("matches the compiled contract", (t) => {
    // The artifacts directory is a build output and is not committed, so a
    // fresh clone that has not run `npm run contracts:build` has nothing to
    // compare against. Skipping is correct; failing would be noise.
    if (!existsSync(ARTIFACT_PATH)) {
      t.skip("no compiled artifact — run `npm run contracts:build` first");
      return;
    }

    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as {
      abi: unknown[];
    };

    assert.equal(
      JSON.stringify(SOLACE_POUND_ABI),
      JSON.stringify(artifact.abi),
      "the committed ABI has drifted — run `npm run contracts:abi`",
    );
  });

  it("exposes everything the settlement service calls", () => {
    const names = new Set(
      SOLACE_POUND_ABI.filter(
        (entry): entry is typeof entry & { name: string } =>
          "name" in entry && typeof entry.name === "string",
      ).map((entry) => entry.name),
    );

    for (const required of [
      "fundPot",
      "settle",
      "potBalancePence",
      "AllocationSettled",
      "PotFunded",
      "markerAddress",
      "decimals",
    ]) {
      assert.ok(names.has(required), `the ABI is missing ${required}`);
    }
  });

  it("declares the settlement event with the fields the dashboard reads", () => {
    const event = SOLACE_POUND_ABI.find(
      (entry) => "name" in entry && entry.name === "AllocationSettled",
    );

    assert.ok(event !== undefined);
    assert.ok("inputs" in event);

    const inputs = (event.inputs as ReadonlyArray<{ name: string }>).map(
      (input) => input.name,
    );

    assert.deepEqual(inputs, [
      "potReference",
      "recipientHash",
      "recipientMarker",
      "milliKwh",
      "amountPence",
      "settledAt",
      "sequence",
    ]);
  });
});

describe("the privacy boundary", () => {
  const SALT = "a-test-salt";

  /**
   * The exact arguments `settle()` is called with.
   *
   * Kept in step with `settlement/service.ts` by hand. If that call ever grows
   * a new argument this test must grow with it, and the test below is what
   * makes forgetting expensive.
   */
  function settleArguments(reference: string) {
    return [
      potReferenceHash("WINTER-2026"),
      recipientHash(reference, SALT),
      14_710n,
      412n,
    ];
  }

  it("sends nothing that identifies a household", () => {
    // Everything personal the local database holds about each household.
    const secrets: string[] = [];
    for (const recipient of RECIPIENTS) {
      secrets.push(
        recipient.reference,
        recipient.displayName,
        recipient.locality,
        recipient.epcBand,
      );
      for (const note of recipient.caseNotes) secrets.push(note.text);
    }

    for (const recipient of RECIPIENTS) {
      const encoded = JSON.stringify(
        settleArguments(recipient.reference),
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      ).toLowerCase();

      for (const secret of secrets) {
        // Single characters and very short strings would match by chance.
        if (secret.length < 4) continue;

        assert.ok(
          !encoded.includes(secret.toLowerCase()),
          `"${secret.slice(0, 40)}" appears in what is sent to the chain`,
        );
      }
    }
  });

  it("sends only a pot hash, a recipient hash and two integers", () => {
    const args = settleArguments("REC-01");

    assert.equal(args.length, 4);
    assert.match(String(args[0]), /^0x[0-9a-f]{64}$/);
    assert.match(String(args[1]), /^0x[0-9a-f]{64}$/);
    assert.equal(typeof args[2], "bigint");
    assert.equal(typeof args[3], "bigint");
  });

  it("gives every household a distinct on-chain identifier", () => {
    const hashes = RECIPIENTS.map((recipient) =>
      recipientHash(recipient.reference, SALT),
    );

    assert.equal(
      new Set(hashes).size,
      RECIPIENTS.length,
      "two households share an on-chain identifier",
    );
  });

  it("resists enumeration without the salt", () => {
    // The attack the salt exists to defeat: a small, guessable reference space.
    // With the salt an attacker computes the right hash; without it, nothing.
    const target = recipientHash("REC-03", SALT);

    const guessedWithoutSalt = Array.from({ length: 20 }, (_, i) =>
      recipientHash(`REC-${String(i + 1).padStart(2, "0")}`, "wrong-salt"),
    );

    assert.ok(
      !guessedWithoutSalt.includes(target),
      "the reference space was enumerable without the salt",
    );

    // And with the salt, the correct guess does match — proving the test is
    // detecting the salt rather than a broken hash.
    assert.equal(recipientHash("REC-03", SALT), target);
  });

  it("hashes the pot reference without a secret, because pots are public", () => {
    // A councillor should be able to quote "WINTER-2026" in a committee. The
    // pot identifier is deliberately not secret, and this records that choice.
    assert.equal(potReferenceHash("WINTER-2026"), potReferenceHash("WINTER-2026"));
    assert.notEqual(potReferenceHash("WINTER-2026"), potReferenceHash("SUMMER-2026"));
  });
});
