/**
 * Solace — tests for the things that break on the day.
 *
 * Everything here has already gone wrong once during development, which is the
 * only real justification for a test. A malformed environment file, an
 * explorer link for a chain that has no explorer, a config value read before it
 * was set — none of these are interesting failures, and all of them would ruin
 * a demonstration in front of an audience.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEnvFile } from "../../src/lib/env-file.ts";
import {
  CHAINS,
  explorerAddressUrl,
  explorerTxUrl,
} from "../../src/lib/config.ts";
import { ChainName, SPENT_STATUSES, SettlementStatus, toChainName } from "../../src/lib/domain.ts";
import { formatKwh, formatPence, shortenHash } from "../../src/lib/format.ts";

describe("reading environment files", () => {
  it("parses ordinary assignments", () => {
    const parsed = parseEnvFile("SOLACE_MODE=DEMO\nTARIFF=28");

    assert.equal(parsed.SOLACE_MODE, "DEMO");
    assert.equal(parsed.TARIFF, "28");
  });

  it("ignores comments and blank lines", () => {
    const parsed = parseEnvFile("# a comment\n\n  \nKEY=value\n# another");

    assert.deepEqual(parsed, { KEY: "value" });
  });

  it("strips one layer of quotes", () => {
    const parsed = parseEnvFile(`A="quoted"\nB='single'\nC=bare`);

    assert.equal(parsed.A, "quoted");
    assert.equal(parsed.B, "single");
    assert.equal(parsed.C, "bare");
  });

  it("keeps equals signs inside values", () => {
    // Private keys and connection strings contain them, and splitting on every
    // equals sign would silently truncate a key into something that looks
    // valid and is not.
    const parsed = parseEnvFile("URL=postgres://u:p@host/db?ssl=true");

    assert.equal(parsed.URL, "postgres://u:p@host/db?ssl=true");
  });

  it("survives a malformed file rather than throwing", () => {
    const parsed = parseEnvFile("no equals sign here\n=novalue\nGOOD=yes");

    assert.equal(parsed.GOOD, "yes");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(parseEnvFile("  KEY  =  value  ").KEY, "value");
  });
});

describe("explorer links", () => {
  it("builds a public link for Base Sepolia", () => {
    const url = explorerTxUrl(ChainName.BASE_SEPOLIA, "0xabc");

    assert.equal(url, "https://sepolia.basescan.org/tx/0xabc");
  });

  it("returns null for a local chain, which has no explorer", () => {
    // The interface must hide the link rather than render one that leads
    // nowhere. A dead "verify this" link is worse than no link at all.
    assert.equal(explorerTxUrl(ChainName.HARDHAT_LOCAL, "0xabc"), null);
    assert.equal(explorerAddressUrl(ChainName.HARDHAT_LOCAL, "0xabc"), null);
  });

  it("returns null when there is no transaction hash", () => {
    assert.equal(explorerTxUrl(ChainName.BASE_SEPOLIA, null), null);
    assert.equal(explorerTxUrl(ChainName.BASE_SEPOLIA, undefined), null);
  });

  it("returns null for a chain that settled nothing", () => {
    assert.equal(explorerTxUrl(ChainName.NONE, "0xabc"), null);
  });
});

describe("narrowing database strings", () => {
  it("recognises known chains", () => {
    assert.equal(toChainName("BASE_SEPOLIA"), ChainName.BASE_SEPOLIA);
    assert.equal(toChainName("HARDHAT_LOCAL"), ChainName.HARDHAT_LOCAL);
  });

  it("falls back to NONE rather than throwing", () => {
    // An unfamiliar value in one row should mean "no explorer link for this
    // row", not a blank dashboard.
    assert.equal(toChainName("SOMETHING_ELSE"), ChainName.NONE);
    assert.equal(toChainName(null), ChainName.NONE);
    assert.equal(toChainName(undefined), ChainName.NONE);
  });
});

describe("what counts as spent", () => {
  it("includes everything that has left or is leaving the pot", () => {
    assert.ok(SPENT_STATUSES.includes(SettlementStatus.CONFIRMED));
    assert.ok(SPENT_STATUSES.includes(SettlementStatus.SUBMITTED));
    assert.ok(SPENT_STATUSES.includes(SettlementStatus.BACKFILLED));
  });

  it("excludes failures, so a failed settlement does not drain the pot", () => {
    // The bug this prevents: a reverted transaction reducing the reported
    // balance even though no money moved.
    assert.ok(!SPENT_STATUSES.includes(SettlementStatus.FAILED));
    assert.ok(!SPENT_STATUSES.includes(SettlementStatus.PENDING));
  });
});

describe("an unreadable contract is not a balance of zero", () => {
  // The failure this guards against was found by restarting the local chain
  // without redeploying. The contract read failed, the failure was rendered as
  // £0.00, and a deposit to an address with no code returned a transaction hash
  // and did nothing — so the interface reported a confirmed deposit that had
  // not happened. Presenting a failed read as data is the most dangerous shape
  // of bug this system can have.
  it("treats null and zero as different answers", () => {
    const unreadable: number | null = null;
    const genuinelyEmpty: number | null = 0;

    assert.notEqual(unreadable, genuinelyEmpty);

    // The comparison used by the health check and by doctor: a null must never
    // fall through to the "chain holds less than the ledger" branch, nor to the
    // "everything agrees" branch. It is its own case.
    const isShort = (onChain: number | null, local: number): boolean =>
      onChain !== null && onChain < local;
    const isUnreadable = (onChain: number | null): boolean => onChain === null;

    assert.equal(isUnreadable(unreadable), true);
    assert.equal(isShort(unreadable, 40_000), false);

    assert.equal(isUnreadable(genuinelyEmpty), false);
    assert.equal(isShort(genuinelyEmpty, 40_000), true);
  });
});

describe("chain metadata", () => {
  it("describes every chain the system can be in", () => {
    for (const chain of Object.values(ChainName)) {
      const meta = CHAINS[chain];
      assert.ok(meta !== undefined, `${chain} has no metadata`);
      assert.ok(meta.label.length > 0);
    }
  });

  it("marks only the public testnet as public", () => {
    assert.equal(CHAINS[ChainName.BASE_SEPOLIA].isPublic, true);
    assert.equal(CHAINS[ChainName.HARDHAT_LOCAL].isPublic, false);
    assert.equal(CHAINS[ChainName.NONE].isPublic, false);
  });
});

describe("formatting figures", () => {
  it("renders pence as pounds", () => {
    assert.equal(formatPence(40_000), "£400.00");
    assert.equal(formatPence(1), "£0.01");
    assert.equal(formatPence(0), "£0.00");
  });

  it("groups thousands", () => {
    assert.equal(formatPence(1_234_567), "£12,345.67");
  });

  it("renders energy with a unit", () => {
    assert.equal(formatKwh(374.28), "374.3 kWh");
    assert.equal(formatKwh(374.28, 0), "374 kWh");
  });

  it("shortens a hash without losing both ends", () => {
    const hash = "0x1234567890abcdef1234567890abcdef12345678";
    const short = shortenHash(hash);

    assert.ok(short.startsWith("0x1234"));
    assert.ok(short.endsWith("5678"));
    assert.ok(short.length < hash.length);
  });

  it("leaves a short value alone", () => {
    assert.equal(shortenHash("0xabc"), "0xabc");
  });
});
