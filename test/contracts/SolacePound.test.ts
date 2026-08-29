/**
 * Solace — SolacePound contract tests.
 *
 * These cover the two properties the whole accountability claim rests on:
 *
 *   1. A settlement records the right facts, and emits them where anybody can
 *      read them.
 *   2. A pot cannot be overspent, and the chain is what enforces that, not our
 *      application code.
 *
 * Everything else here is the ordinary business of checking that access control
 * and input validation do what they say.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, toHex, getAddress, parseEventLogs } from "viem";

const POT_REFERENCE = keccak256(toHex("WINTER-2026"));

/** Stands in for an HMAC of a household reference, computed off-chain. */
const RECIPIENT_HASH = keccak256(toHex("REC-03"));
const OTHER_RECIPIENT_HASH = keccak256(toHex("REC-07"));

/** £2,500.00 expressed in pence, matching the demo pot. */
const POT_FUNDING_PENCE = 250_000n;

describe("SolacePound", async () => {
  const { viem } = await network.getOrCreate();

  let treasury: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let outsider: Awaited<ReturnType<typeof viem.getWalletClients>>[number];

  before(async () => {
    [treasury, outsider] = await viem.getWalletClients();
  });

  async function deploy() {
    return viem.deployContract("SolacePound", [treasury.account.address]);
  }

  async function deployAndFund() {
    const token = await deploy();
    await token.write.fundPot([
      POT_REFERENCE,
      treasury.account.address,
      POT_FUNDING_PENCE,
      "HSF/2026/0417",
    ]);
    return token;
  }

  // -------------------------------------------------------------------------
  // Denomination
  // -------------------------------------------------------------------------

  describe("denomination", () => {
    it("is named and symbolled for a GBP settlement token", async () => {
      const token = await deploy();

      assert.equal(await token.read.name(), "SolacePound");
      assert.equal(await token.read.symbol(), "SLP");
    });

    it("uses two decimals so one token is one pound and one unit is one penny", async () => {
      const token = await deploy();

      // This is the property that lets an integer pence figure in the council's
      // ledger be the same number on chain, with no scaling in between.
      assert.equal(await token.read.decimals(), 2);
    });
  });

  // -------------------------------------------------------------------------
  // Funding
  // -------------------------------------------------------------------------

  describe("funding a pot", () => {
    it("credits the treasury and records the pot balance", async () => {
      const token = await deployAndFund();

      assert.equal(
        await token.read.balanceOf([treasury.account.address]),
        POT_FUNDING_PENCE,
      );
      assert.equal(
        await token.read.potFundedPence([POT_REFERENCE]),
        POT_FUNDING_PENCE,
      );
      assert.equal(
        await token.read.potBalancePence([POT_REFERENCE]),
        POT_FUNDING_PENCE,
      );
    });

    it("emits PotFunded carrying the council's own payment reference", async () => {
      const token = await deploy();

      await viem.assertions.emitWithArgs(
        token.write.fundPot([
          POT_REFERENCE,
          treasury.account.address,
          POT_FUNDING_PENCE,
          "HSF/2026/0417",
        ]),
        token,
        "PotFunded",
        [
          POT_REFERENCE,
          getAddress(treasury.account.address),
          POT_FUNDING_PENCE,
          "HSF/2026/0417",
        ],
      );
    });

    it("accumulates across several deposits into the same pot", async () => {
      const token = await deployAndFund();

      await token.write.fundPot([
        POT_REFERENCE,
        treasury.account.address,
        50_000n,
        "HSF/2026/0511",
      ]);

      assert.equal(
        await token.read.potBalancePence([POT_REFERENCE]),
        POT_FUNDING_PENCE + 50_000n,
      );
    });

    it("refuses funding from anyone but the owner", async () => {
      const token = await deploy();
      const asOutsider = await viem.getContractAt(
        "SolacePound",
        token.address,
        { client: { wallet: outsider } },
      );

      await viem.assertions.revertWithCustomError(
        asOutsider.write.fundPot([
          POT_REFERENCE,
          outsider.account.address,
          POT_FUNDING_PENCE,
          "not-authorised",
        ]),
        token,
        "OwnableUnauthorizedAccount",
      );
    });

    it("rejects a zero pot reference", async () => {
      const token = await deploy();

      await viem.assertions.revertWithCustomError(
        token.write.fundPot([
          `0x${"0".repeat(64)}`,
          treasury.account.address,
          POT_FUNDING_PENCE,
          "ref",
        ]),
        token,
        "InvalidPotReference",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Settlement
  // -------------------------------------------------------------------------

  describe("settling an allocation", () => {
    it("moves tokens, drains the pot, and credits the hashed recipient", async () => {
      const token = await deployAndFund();

      // 14.71 kWh delivered, costing £4.12.
      await token.write.settle([POT_REFERENCE, RECIPIENT_HASH, 14_710n, 412n]);

      const marker = await token.read.markerAddress([RECIPIENT_HASH]);

      assert.equal(
        await token.read.potBalancePence([POT_REFERENCE]),
        POT_FUNDING_PENCE - 412n,
        "the pot must fall by exactly the settled amount",
      );
      assert.equal(await token.read.potSpentPence([POT_REFERENCE]), 412n);
      assert.equal(await token.read.balanceOf([marker]), 412n);
      assert.equal(
        await token.read.balanceOf([treasury.account.address]),
        POT_FUNDING_PENCE - 412n,
      );
      assert.equal(
        await token.read.recipientReceivedPence([RECIPIENT_HASH]),
        412n,
      );
      assert.equal(await token.read.recipientMilliKwh([RECIPIENT_HASH]), 14_710n);
      assert.equal(
        await token.read.recipientSettlementCount([RECIPIENT_HASH]),
        1n,
      );
      assert.equal(await token.read.settlementCount(), 1n);
    });

    it("emits AllocationSettled with the energy, amount and pot on the record", async () => {
      const token = await deployAndFund();

      const txHash = await token.write.settle([
        POT_REFERENCE,
        RECIPIENT_HASH,
        14_710n,
        412n,
      ]);

      const publicClient = await viem.getPublicClient();
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      const logs = parseEventLogs({
        abi: token.abi,
        eventName: "AllocationSettled",
        logs: receipt.logs,
      });

      assert.equal(logs.length, 1, "exactly one settlement event per allocation");

      const settled = logs[0].args;
      assert.equal(settled.potReference, POT_REFERENCE);
      assert.equal(settled.recipientHash, RECIPIENT_HASH);
      assert.equal(settled.milliKwh, 14_710n);
      assert.equal(settled.amountPence, 412n);
      assert.equal(settled.sequence, 1n);

      // The pre-image of the recipient hash must be nowhere in the event. This
      // is the privacy guarantee, asserted rather than merely documented.
      const encoded = JSON.stringify(settled, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ).toLowerCase();
      assert.ok(
        !encoded.includes("rec-03"),
        "no household reference may appear on chain",
      );
    });

    it("also emits a standard ERC-20 Transfer, so ordinary tooling sees it", async () => {
      const token = await deployAndFund();

      await viem.assertions.emit(
        token.write.settle([POT_REFERENCE, RECIPIENT_HASH, 14_710n, 412n]),
        token,
        "Transfer",
      );
    });

    it("accumulates repeat settlements against the same household", async () => {
      const token = await deployAndFund();

      await token.write.settle([POT_REFERENCE, RECIPIENT_HASH, 10_000n, 280n]);
      await token.write.settle([POT_REFERENCE, RECIPIENT_HASH, 5_000n, 140n]);

      assert.equal(await token.read.recipientMilliKwh([RECIPIENT_HASH]), 15_000n);
      assert.equal(
        await token.read.recipientReceivedPence([RECIPIENT_HASH]),
        420n,
      );
      assert.equal(
        await token.read.recipientSettlementCount([RECIPIENT_HASH]),
        2n,
        "the dashboard needs this to explain why a household recurs",
      );
    });

    it("numbers settlements monotonically so they have a total order", async () => {
      const token = await deployAndFund();

      await token.write.settle([POT_REFERENCE, RECIPIENT_HASH, 10_000n, 280n]);
      await token.write.settle([
        POT_REFERENCE,
        OTHER_RECIPIENT_HASH,
        10_000n,
        280n,
      ]);

      assert.equal(await token.read.settlementCount(), 2n);
    });

    it("refuses to overdraw the pot", async () => {
      const token = await deployAndFund();

      // The single most important test in this file. A council pot cannot be
      // spent past its balance, and it is the chain that says so.
      await viem.assertions.revertWithCustomErrorWithArgs(
        token.write.settle([
          POT_REFERENCE,
          RECIPIENT_HASH,
          10_000n,
          POT_FUNDING_PENCE + 1n,
        ]),
        token,
        "PotOverdrawn",
        [POT_REFERENCE, POT_FUNDING_PENCE, POT_FUNDING_PENCE + 1n],
      );
    });

    it("allows a settlement for exactly the remaining balance", async () => {
      const token = await deployAndFund();

      await token.write.settle([
        POT_REFERENCE,
        RECIPIENT_HASH,
        10_000n,
        POT_FUNDING_PENCE,
      ]);

      assert.equal(await token.read.potBalancePence([POT_REFERENCE]), 0n);
    });

    it("refuses settlement from an unauthorised address", async () => {
      const token = await deployAndFund();
      const asOutsider = await viem.getContractAt(
        "SolacePound",
        token.address,
        { client: { wallet: outsider } },
      );

      await viem.assertions.revertWithCustomError(
        asOutsider.write.settle([POT_REFERENCE, RECIPIENT_HASH, 10_000n, 280n]),
        token,
        "NotASettler",
      );
    });

    it("rejects a zero recipient hash", async () => {
      const token = await deployAndFund();

      await viem.assertions.revertWithCustomError(
        token.write.settle([
          POT_REFERENCE,
          `0x${"0".repeat(64)}`,
          10_000n,
          280n,
        ]),
        token,
        "InvalidRecipientHash",
      );
    });

    it("rejects a settlement carrying no energy", async () => {
      const token = await deployAndFund();

      await viem.assertions.revertWithCustomError(
        token.write.settle([POT_REFERENCE, RECIPIENT_HASH, 0n, 280n]),
        token,
        "InvalidEnergyAmount",
      );
    });

    it("rejects a settlement carrying no money", async () => {
      const token = await deployAndFund();

      await viem.assertions.revertWithCustomError(
        token.write.settle([POT_REFERENCE, RECIPIENT_HASH, 10_000n, 0n]),
        token,
        "InvalidSettlementAmount",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Settler administration
  // -------------------------------------------------------------------------

  describe("settler authorisation", () => {
    it("authorises the owner at deployment", async () => {
      const token = await deploy();

      assert.equal(await token.read.isSettler([treasury.account.address]), true);
      assert.equal(await token.read.isSettler([outsider.account.address]), false);
    });

    it("lets the owner authorise and revoke a settlement service", async () => {
      const token = await deployAndFund();

      await token.write.setSettler([outsider.account.address, true]);
      assert.equal(await token.read.isSettler([outsider.account.address]), true);

      await token.write.setSettler([outsider.account.address, false]);
      assert.equal(await token.read.isSettler([outsider.account.address]), false);
    });

    it("refuses to let a non-owner authorise anybody", async () => {
      const token = await deploy();
      const asOutsider = await viem.getContractAt(
        "SolacePound",
        token.address,
        { client: { wallet: outsider } },
      );

      await viem.assertions.revertWithCustomError(
        asOutsider.write.setSettler([outsider.account.address, true]),
        token,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Marker addresses
  // -------------------------------------------------------------------------

  describe("recipient marker addresses", () => {
    it("derives the same address for the same hash every time", async () => {
      const token = await deploy();

      const first = await token.read.markerAddress([RECIPIENT_HASH]);
      const second = await token.read.markerAddress([RECIPIENT_HASH]);

      assert.equal(first, second);
    });

    it("derives different addresses for different households", async () => {
      const token = await deploy();

      const one = await token.read.markerAddress([RECIPIENT_HASH]);
      const other = await token.read.markerAddress([OTHER_RECIPIENT_HASH]);

      assert.notEqual(one, other);
    });
  });
});
