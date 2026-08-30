/**
 * Solace — put the demonstration back to its opening state.
 *
 * Clears deposits, allocations and settlements so the six beats can be
 * performed again from the beginning. The households, the thirty days of meter
 * data and the parsed case notes are untouched — regenerating those takes
 * minutes and nothing about them changes between runs.
 *
 * This exists because a demonstration that can only be given once cannot be
 * rehearsed, and a demonstration nobody has rehearsed is one that fails.
 */

import { DEMO_POT } from "@/lib/synthetic/households";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const pot = await prisma.pot.findUnique({
      where: { reference: DEMO_POT.reference },
    });
    if (pot === null) {
      return json({ ok: false, error: "No pot has been set up yet." }, 404);
    }

    // Order matters: settlements reference allocations, allocations reference
    // the run.
    const settlements = await prisma.settlement.deleteMany();
    const allocations = await prisma.allocation.deleteMany();
    await prisma.allocationRun.deleteMany();
    const deposits = await prisma.deposit.deleteMany();
    await prisma.report.deleteMany();

    return json({
      ok: true,
      cleared: {
        settlements: settlements.count,
        allocations: allocations.count,
        deposits: deposits.count,
      },
      note:
        "Households, meter data and parsed case notes were left in place. " +
        "The chain still holds the transactions from the previous run; the pot " +
        "is re-funded on the next deposit.",
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
