/**
 * Solace — a council deposits into the pot.
 *
 * Beat one of the demonstration. This is a real transaction: the amount is
 * minted into the treasury's balance and recorded against the pot on chain, and
 * the response carries the transaction hash it produced.
 *
 * The amount is chosen by the caller, because a councillor deciding what to
 * commit is the entire premise. It is bounded so a stray keystroke cannot mint
 * a meaningless figure into the demonstration.
 */

import { DEMO_POT } from "@/lib/synthetic/households";
import { fundPot, reconcilePotFunding, resolveChainContext } from "@/lib/settlement/service";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** £1 to £1,000,000, in pence. */
const MIN_PENCE = 100;
const MAX_PENCE = 100_000_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      amountPence?: unknown;
      reference?: unknown;
    };

    const amountPence = Math.round(Number(body.amountPence));

    if (!Number.isFinite(amountPence) || amountPence < MIN_PENCE) {
      return json(
        { ok: false, error: "Enter an amount of at least £1." },
        { status: 400 },
      );
    }
    if (amountPence > MAX_PENCE) {
      return json(
        { ok: false, error: "That is larger than this demonstration accepts." },
        { status: 400 },
      );
    }

    const pot = await prisma.pot.findUnique({
      where: { reference: DEMO_POT.reference },
    });
    if (pot === null) {
      return json({ ok: false, error: "No pot has been set up yet." }, { status: 404 });
    }

    const resolved = await resolveChainContext();
    if (!resolved.ok) {
      return json({ ok: false, error: resolved.reason }, { status: 503 });
    }

    // A local chain forgets its state when it restarts; the database does not.
    // Check before adding to a total the chain may no longer agree with.
    await reconcilePotFunding(pot.id, pot.reference);

    // A distinct reference per deposit, so repeated deposits accumulate rather
    // than overwriting one another.
    const reference =
      typeof body.reference === "string" && body.reference.trim() !== ""
        ? body.reference.trim().slice(0, 40)
        : `HSF/${new Date().getUTCFullYear()}/${Date.now().toString().slice(-5)}`;

    const outcome = await fundPot({
      potId: pot.id,
      potReference: pot.reference,
      amountPence,
      councilReference: reference,
      context: resolved.context,
    });

    if (!outcome.ok) {
      return json({ ok: false, error: outcome.error }, { status: 502 });
    }

    return json({
      ok: true,
      amountPence,
      reference,
      txHash: outcome.txHash,
      explorerUrl: outcome.explorerUrl,
      chain: resolved.context.chain,
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
}
