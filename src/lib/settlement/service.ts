/**
 * Solace — settlement.
 *
 * Turns an allocation decision into a transaction on a public ledger, and
 * records what happened either way.
 *
 * WHAT CROSSES THE PRIVACY BOUNDARY
 *
 * Exactly four things reach the contract: a pot reference, an HMAC of the
 * recipient's internal household reference, an integer quantity of energy in
 * thousandths of a kilowatt-hour, and an amount in pence. Names, addresses,
 * benefit status, health conditions, EPC bands, household composition and case
 * notes stay in the local database, because they are never passed to a contract
 * call. The hashing happens in `privacy.ts` and nowhere else.
 *
 * WHAT HAPPENS WHEN THE CHAIN IS UNAVAILABLE
 *
 * A failed settlement is recorded as FAILED with the reason, and the run
 * continues. It does not throw, it does not retry forever, and it never leaves
 * the interface with nothing to show. Parliamentary wifi is not a dependency
 * this demonstration can afford to have.
 */

import type { Address } from "viem";

import { ACTIVE_CHAIN, explorerTxUrl } from "../config.ts";
import {
  ChainName,
  SettlementStatus,
  SPENT_STATUSES,
} from "../domain.ts";
import { prisma } from "../db.ts";
import { potReferenceHash } from "../privacy.ts";
import { publicClient, tokenAddress, walletClient } from "../chain/client.ts";
import { SOLACE_POUND_ABI } from "../chain/solace-pound-abi.ts";

export interface SettlementOutcome {
  ok: boolean;
  status: (typeof SettlementStatus)[keyof typeof SettlementStatus];
  txHash: string | null;
  explorerUrl: string | null;
  error: string | null;
}

/** Everything needed to settle, resolved once and reused across a batch. */
interface ChainContext {
  address: Address;
  chain: ChainName;
}

/**
 * Resolve the chain context, or explain why settlement cannot proceed.
 *
 * Called once per batch rather than per allocation, so 292 settlements do not
 * make 292 identical checks.
 */
export async function resolveChainContext(): Promise<
  { ok: true; context: ChainContext } | { ok: false; reason: string }
> {
  const wallet = walletClient();
  if (wallet === null) {
    return {
      ok: false,
      reason:
        "No settlement key is configured. Set DEPLOYER_PRIVATE_KEY in .env.local, or run in demo mode against a local chain.",
    };
  }

  const address = await tokenAddress(ACTIVE_CHAIN);
  if (address === null) {
    return {
      ok: false,
      reason: `SolacePound is not deployed on ${ACTIVE_CHAIN}. Run \`npm run deploy:local\` or \`npm run deploy:testnet\` first.`,
    };
  }

  try {
    await publicClient().getChainId();
  } catch {
    return {
      ok: false,
      reason: `Could not reach the ${ACTIVE_CHAIN} node. Settlement is paused; the ledger already recorded is unaffected.`,
    };
  }

  return { ok: true, context: { address, chain: ACTIVE_CHAIN } };
}

// ---------------------------------------------------------------------------
// Funding a pot
// ---------------------------------------------------------------------------

/**
 * Place council money into a pot, on chain.
 *
 * Beat one of the demonstration. Creates the Deposit record first, so that a
 * transaction which succeeds on chain but fails to be recorded locally is
 * visible as a pending deposit rather than vanishing.
 */
export async function fundPot(args: {
  potId: string;
  potReference: string;
  amountPence: number;
  councilReference: string;
  context: ChainContext;
}): Promise<SettlementOutcome> {
  const { potId, potReference, amountPence, councilReference, context } = args;

  const depositId = `dep_${potReference.toLowerCase()}_${councilReference.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;

  await prisma.deposit.upsert({
    where: { id: depositId },
    create: {
      id: depositId,
      potId,
      amountPence,
      reference: councilReference,
      depositedAt: new Date(),
      chain: context.chain,
      status: SettlementStatus.PENDING,
    },
    update: { status: SettlementStatus.PENDING, chain: context.chain },
  });

  const wallet = walletClient();
  const client = publicClient();
  if (wallet === null || wallet.account === undefined) {
    return recordDepositFailure(depositId, "No settlement key is configured.");
  }

  try {
    const hash = await wallet.writeContract({
      address: context.address,
      abi: SOLACE_POUND_ABI,
      functionName: "fundPot",
      args: [
        potReferenceHash(potReference),
        wallet.account.address,
        BigInt(amountPence),
        councilReference,
      ],
      chain: wallet.chain,
      account: wallet.account,
    });

    const receipt = await client.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      return recordDepositFailure(depositId, `Transaction ${hash} reverted.`);
    }

    const explorerUrl = explorerTxUrl(context.chain, hash);

    await prisma.deposit.update({
      where: { id: depositId },
      data: {
        status: SettlementStatus.CONFIRMED,
        txHash: hash,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl,
      },
    });

    return {
      ok: true,
      status: SettlementStatus.CONFIRMED,
      txHash: hash,
      explorerUrl,
      error: null,
    };
  } catch (error) {
    return recordDepositFailure(depositId, describe(error));
  }
}

async function recordDepositFailure(
  depositId: string,
  reason: string,
): Promise<SettlementOutcome> {
  await prisma.deposit.update({
    where: { id: depositId },
    data: { status: SettlementStatus.FAILED },
  });

  return {
    ok: false,
    status: SettlementStatus.FAILED,
    txHash: null,
    explorerUrl: null,
    error: reason,
  };
}

// ---------------------------------------------------------------------------
// Settling an allocation
// ---------------------------------------------------------------------------

/**
 * Settle one allocation on chain.
 *
 * The Settlement row is written before the transaction is sent, in PENDING.
 * That ordering is deliberate: a transaction that succeeds on chain while the
 * process dies must leave evidence behind. A settlement with no local record is
 * money that moved with nothing to explain it, which is precisely the failure
 * Solace exists to prevent.
 */
export async function settleAllocation(args: {
  allocationId: string;
  context: ChainContext;
}): Promise<SettlementOutcome> {
  const { allocationId, context } = args;

  const allocation = await prisma.allocation.findUnique({
    where: { id: allocationId },
    include: { recipient: true, pot: true },
  });

  if (allocation === null) {
    return failure(`No allocation with id ${allocationId}.`);
  }

  const recipientHash = allocation.recipient.recipientHash;
  if (recipientHash === null) {
    return failure(
      `${allocation.recipient.reference} has no recipient hash. Re-run the seed.`,
    );
  }

  const settlementId = `set_${allocation.id}`;
  const potReference = allocation.pot.reference;

  await prisma.settlement.upsert({
    where: { allocationId: allocation.id },
    create: {
      id: settlementId,
      allocationId: allocation.id,
      status: SettlementStatus.PENDING,
      chain: context.chain,
      recipientHash,
      potReference,
      milliKwh: allocation.milliKwh,
      amountPence: allocation.amountPence,
      // decimals is 2, so one token unit is one penny and the raw amount is the
      // pence figure unchanged. No scaling, no rounding.
      tokenAmountRaw: String(allocation.amountPence),
    },
    update: {
      status: SettlementStatus.PENDING,
      chain: context.chain,
      failureReason: null,
    },
  });

  const wallet = walletClient();
  const client = publicClient();
  if (wallet === null || wallet.account === undefined) {
    return recordSettlementFailure(
      settlementId,
      "No settlement key is configured.",
    );
  }

  try {
    const hash = await wallet.writeContract({
      address: context.address,
      abi: SOLACE_POUND_ABI,
      functionName: "settle",
      args: [
        potReferenceHash(potReference),
        recipientHash as `0x${string}`,
        BigInt(allocation.milliKwh),
        BigInt(allocation.amountPence),
      ],
      chain: wallet.chain,
      account: wallet.account,
    });

    await prisma.settlement.update({
      where: { id: settlementId },
      data: { status: SettlementStatus.SUBMITTED, txHash: hash, submittedAt: new Date() },
    });

    const receipt = await client.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      return recordSettlementFailure(settlementId, `Transaction ${hash} reverted.`);
    }

    const explorerUrl = explorerTxUrl(context.chain, hash);

    await prisma.settlement.update({
      where: { id: settlementId },
      data: {
        status: SettlementStatus.CONFIRMED,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl,
        confirmedAt: new Date(),
      },
    });

    return {
      ok: true,
      status: SettlementStatus.CONFIRMED,
      txHash: hash,
      explorerUrl,
      error: null,
    };
  } catch (error) {
    return recordSettlementFailure(settlementId, describe(error));
  }
}

async function recordSettlementFailure(
  settlementId: string,
  reason: string,
): Promise<SettlementOutcome> {
  await prisma.settlement.update({
    where: { id: settlementId },
    data: { status: SettlementStatus.FAILED, failureReason: reason },
  });

  return {
    ok: false,
    status: SettlementStatus.FAILED,
    txHash: null,
    explorerUrl: null,
    error: reason,
  };
}

// ---------------------------------------------------------------------------
// Reading the ledger back
// ---------------------------------------------------------------------------

/**
 * What the chain says is left in the pot, in pence.
 *
 * Returns null if the chain cannot be reached. The dashboard shows its own
 * derived figure in that case and says which one it is showing — a number
 * without a stated source is worse than no number.
 */
export async function onChainPotBalancePence(
  potReference: string,
): Promise<number | null> {
  try {
    const address = await tokenAddress(ACTIVE_CHAIN);
    if (address === null) return null;

    const balance = await publicClient().readContract({
      address,
      abi: SOLACE_POUND_ABI,
      functionName: "potBalancePence",
      args: [potReferenceHash(potReference)],
    });

    return Number(balance);
  } catch {
    return null;
  }
}

/** What the contract says has been paid into a pot, in pence. Null if unreachable. */
export async function onChainPotFundedPence(
  potReference: string,
): Promise<number | null> {
  try {
    const address = await tokenAddress(ACTIVE_CHAIN);
    if (address === null) return null;

    const funded = await publicClient().readContract({
      address,
      abi: SOLACE_POUND_ABI,
      functionName: "potFundedPence",
      args: [potReferenceHash(potReference)],
    });

    return Number(funded);
  } catch {
    return null;
  }
}

/**
 * Reconcile the local deposit record against the chain.
 *
 * A local Hardhat node keeps no state between restarts, but the database does.
 * Restart the node and the application still believes the pot holds £400, while
 * the freshly deployed contract believes it holds nothing — so every settlement
 * reverts with `PotOverdrawn` and the whole run fails for a reason that looks
 * nothing like the cause.
 *
 * This is exactly the failure that ruins a demonstration: it is silent, it
 * follows an ordinary action (restarting a terminal), and the error it produces
 * points at the wrong thing.
 *
 * So the chain is treated as the authority. If it has been funded with less
 * than the database claims, the local deposits are marked as not having
 * happened and the caller is told to fund again.
 */
export async function reconcilePotFunding(potId: string, potReference: string): Promise<{
  reconciled: boolean;
  onChainPence: number | null;
  localPence: number;
  message: string | null;
}> {
  const [onChainPence, local] = await Promise.all([
    onChainPotFundedPence(potReference),
    prisma.deposit.aggregate({
      where: { potId, status: { in: [...SPENT_STATUSES] } },
      _sum: { amountPence: true },
    }),
  ]);

  const localPence = local._sum.amountPence ?? 0;

  if (onChainPence === null) {
    return {
      reconciled: false,
      onChainPence,
      localPence,
      message: "Could not read the pot balance from the chain.",
    };
  }

  if (onChainPence >= localPence) {
    return { reconciled: false, onChainPence, localPence, message: null };
  }

  // The chain has less than we recorded. Our record is the one that is wrong.
  await prisma.deposit.updateMany({
    where: { potId, status: { in: [...SPENT_STATUSES] } },
    data: {
      status: SettlementStatus.FAILED,
      txHash: null,
      blockNumber: null,
      explorerUrl: null,
    },
  });

  return {
    reconciled: true,
    onChainPence,
    localPence,
    message:
      `The chain reports ${onChainPence} pence in this pot but the database recorded ${localPence}. ` +
      `The chain was most likely restarted. The stale deposit has been cleared and the pot needs funding again.`,
  };
}

/** Allocations with no settlement yet, oldest first. */
export async function pendingAllocations(potId: string, take?: number) {
  return prisma.allocation.findMany({
    where: {
      potId,
      OR: [
        { settlement: null },
        { settlement: { status: SettlementStatus.FAILED } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(take === undefined ? {} : { take }),
  });
}

/** Money considered spent: everything settled or being settled. */
export async function spentPence(potId: string): Promise<number> {
  const result = await prisma.allocation.aggregate({
    where: { potId, settlement: { status: { in: [...SPENT_STATUSES] } } },
    _sum: { amountPence: true },
  });

  return result._sum.amountPence ?? 0;
}

function failure(reason: string): SettlementOutcome {
  return {
    ok: false,
    status: SettlementStatus.FAILED,
    txHash: null,
    explorerUrl: null,
    error: reason,
  };
}

/**
 * Turn an unknown thrown value into something worth showing a person.
 *
 * viem reports a reverted call as "The contract function reverted", which names
 * the symptom and hides the cause. Our contract reverts with named custom
 * errors — `PotOverdrawn`, `NotASettler` — and those names are the whole
 * diagnosis, so they are dug out of the error's cause chain and reported.
 */
function describe(error: unknown): string {
  const revertName = findRevertName(error);

  if (error instanceof Error) {
    const short =
      "shortMessage" in error && typeof error.shortMessage === "string"
        ? error.shortMessage
        : error.message.split("\n")[0].trim();

    return revertName === null ? short : `${short} (${revertName})`;
  }

  return String(error);
}

/** Walk an error's cause chain looking for a decoded custom error name. */
function findRevertName(error: unknown, depth = 0): string | null {
  if (depth > 8 || error === null || typeof error !== "object") return null;

  const candidate = error as {
    data?: { errorName?: string; args?: unknown[] };
    cause?: unknown;
  };

  if (typeof candidate.data?.errorName === "string") {
    const args = candidate.data.args;
    return Array.isArray(args) && args.length > 0
      ? `${candidate.data.errorName}: ${args.map(String).join(", ")}`
      : candidate.data.errorName;
  }

  return findRevertName(candidate.cause, depth + 1);
}
