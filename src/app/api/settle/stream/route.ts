/**
 * Solace — settle pending allocations, streaming each one as it confirms.
 *
 * Server-sent events rather than a request that returns when everything is
 * done. The point of the demonstration is watching the money leave the pot one
 * transaction at a time, and a spinner followed by a finished total shows
 * nothing.
 *
 * Nothing here is faked. Each event is emitted after a real transaction has
 * been mined and its receipt confirmed. The only artifice is `pace`, which puts
 * a pause between settlements so a human can follow them — on a local chain
 * they otherwise complete in about four milliseconds each, which is too fast to
 * read.
 */

import { DEMO_POT } from "@/lib/synthetic/households";
import { prisma } from "@/lib/db";
import {
  pendingAllocations,
  resolveChainContext,
  settleAllocation,
} from "@/lib/settlement/service";
import { SPENT_STATUSES } from "@/lib/domain";

export const dynamic = "force-dynamic";

/** Most allocations to settle in one stream. Guards against a runaway request. */
const MAX_BATCH = 200;

/** Default pause between settlements, in milliseconds. */
const DEFAULT_PACE_MS = 450;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const limit = clamp(Number(url.searchParams.get("limit") ?? 12), 1, MAX_BATCH);
  const pace = clamp(Number(url.searchParams.get("pace") ?? DEFAULT_PACE_MS), 0, 5_000);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The client navigated away mid-stream. Nothing to recover.
          closed = true;
        }
      };

      // If the viewer closes the tab, stop settling. Continuing would spend
      // money nobody is watching.
      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      try {
        const pot = await prisma.pot.findUnique({
          where: { reference: DEMO_POT.reference },
        });

        if (pot === null) {
          send({ type: "error", reason: "No pot has been set up yet." });
          return;
        }

        const resolved = await resolveChainContext();
        if (!resolved.ok) {
          send({ type: "error", reason: resolved.reason });
          return;
        }

        const pending = await pendingAllocations(pot.id, limit);

        send({
          type: "start",
          pending: pending.length,
          balancePence: await balanceFor(pot.id),
        });

        if (pending.length === 0) {
          send({
            type: "done",
            confirmed: 0,
            failed: 0,
            balancePence: await balanceFor(pot.id),
            message:
              "Every allocation is already settled. Reset the demonstration to run it again.",
          });
          return;
        }

        let confirmed = 0;
        let failed = 0;

        for (const allocation of pending) {
          if (closed) break;

          const outcome = await settleAllocation({
            allocationId: allocation.id,
            context: resolved.context,
          });

          if (outcome.ok) {
            confirmed += 1;
          } else {
            failed += 1;
          }

          const detail = await prisma.allocation.findUnique({
            where: { id: allocation.id },
            include: { exporter: true, recipient: true },
          });

          send({
            type: outcome.ok ? "settled" : "failed",
            allocation: {
              id: allocation.id,
              kwh: allocation.kwh,
              amountPence: allocation.amountPence,
              date: allocation.createdAt.toISOString(),
              exporterLocality: detail?.exporter.locality ?? "",
              recipientLocality: detail?.recipient.locality ?? "",
              recipientReference: detail?.recipient.reference ?? "",
            },
            txHash: outcome.txHash,
            explorerUrl: outcome.explorerUrl,
            error: outcome.error,
            balancePence: await balanceFor(pot.id),
          });

          if (pace > 0 && !closed) {
            await new Promise((resolve) => setTimeout(resolve, pace));
          }
        }

        send({
          type: "done",
          confirmed,
          failed,
          balancePence: await balanceFor(pot.id),
        });
      } catch (error) {
        // A stream that dies silently leaves the interface spinning forever.
        send({
          type: "error",
          reason: error instanceof Error ? error.message : String(error),
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer would defeat the entire point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}

/** Deposits minus everything settled, in pence. */
async function balanceFor(potId: string): Promise<number> {
  const [deposits, spend] = await Promise.all([
    prisma.deposit.aggregate({
      where: { potId, status: { in: [...SPENT_STATUSES] } },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId, settlement: { status: { in: [...SPENT_STATUSES] } } },
      _sum: { amountPence: true },
    }),
  ]);

  return (deposits._sum.amountPence ?? 0) - (spend._sum.amountPence ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
