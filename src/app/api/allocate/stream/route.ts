/**
 * Solace — run the allocation engine, streaming its reasoning as it goes.
 *
 * Beat three: the engine runs and shows its working.
 *
 * The solver itself finishes in about fifty milliseconds, which is far too fast
 * to watch and far too fast to trust. So the run is broken into the three steps
 * it actually performs, and each is streamed:
 *
 *   1. Every household is assessed — need score, eligibility, and the reason.
 *   2. The window is solved.
 *   3. The highest-priority decisions are published with their full reasoning.
 *
 * Nothing is invented for the sake of the stream. Every event carries a value
 * the engine genuinely produced, and the pacing exists so a person can read
 * them, which is stated in the interface rather than hidden.
 */

import { allocate } from "@/lib/engine/allocate";
import { currentPotBalancePence, loadAllocationInput } from "@/lib/engine/load";
import { DEMO_POT, householdId } from "@/lib/synthetic/households";
import { prisma } from "@/lib/db";
import { toJsonColumn } from "@/lib/domain";

export const dynamic = "force-dynamic";

const DEFAULT_PACE_MS = 320;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pace = clamp(Number(url.searchParams.get("pace") ?? DEFAULT_PACE_MS), 0, 3_000);
  const seed =
    url.searchParams.get("seed")?.trim() || "solace-allocation-2026";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const pause = async (): Promise<void> => {
        if (pace > 0 && !closed) {
          await new Promise((resolve) => setTimeout(resolve, pace));
        }
      };

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

        const bounds = await prisma.meterReading.aggregate({
          _min: { intervalStart: true },
          _max: { intervalStart: true },
        });
        if (
          bounds._min.intervalStart === null ||
          bounds._max.intervalStart === null
        ) {
          send({
            type: "error",
            reason: "There is no meter data to allocate against.",
          });
          return;
        }

        const windowStart = bounds._min.intervalStart.toISOString().slice(0, 10);
        const windowEnd = bounds._max.intervalStart.toISOString().slice(0, 10);

        const balancePence = await currentPotBalancePence(pot.id);
        if (balancePence <= 0) {
          send({
            type: "error",
            reason:
              "The pot holds nothing. Make a deposit before running the engine.",
          });
          return;
        }

        send({
          type: "start",
          windowStart,
          windowEnd,
          seed,
          balancePence,
        });
        await pause();

        const input = await loadAllocationInput({
          potReference: pot.reference,
          windowStart,
          windowEnd,
          seed,
        });
        input.potBalancePence = balancePence;

        send({
          type: "loaded",
          exporters: input.exporters.length,
          recipients: input.recipients.length,
          days: input.conditions.length,
        });
        await pause();

        // The solver. Deterministic, pure, and over in milliseconds.
        const started = Date.now();
        const result = allocate(input);
        const elapsedMs = Date.now() - started;

        // Step one, replayed for the viewer: what the engine concluded about
        // each household, worst-off first.
        const ordered = [...result.assessments].sort(
          (a, b) => b.needScore - a.needScore,
        );

        for (const assessment of ordered) {
          if (closed) break;

          const recipient = input.recipients.find(
            (r) => r.reference === assessment.recipientReference,
          );

          send({
            type: "assessed",
            reference: assessment.recipientReference,
            locality: recipient?.locality ?? "",
            needScore: assessment.needScore,
            eligible: assessment.eligible,
            reason: assessment.ineligibleReason,
            actualDailyKwh: assessment.actualDailyKwh,
            expectedDailyKwh: assessment.expectedDailyKwh,
          });
          await pause();
        }

        send({
          type: "solved",
          decisions: result.decisions.length,
          totalKwh: result.totalKwh,
          totalPence: result.totalPence,
          unallocatedKwh: result.unallocatedKwh,
          inputDigest: result.inputDigest,
          outputDigest: result.outputDigest,
          engineVersion: result.engineVersion,
          elapsedMs,
          notes: result.notes,
        });
        await pause();

        // Prove reproducibility in front of the audience rather than in a test
        // file nobody will open.
        const replay = allocate(input);
        send({
          type: "replayed",
          identical: replay.outputDigest === result.outputDigest,
          outputDigest: replay.outputDigest,
        });
        await pause();

        await persist(pot.id, result, seed);

        // The decisions that mattered most, with their full reasoning.
        const highlights = [...result.decisions]
          .sort((a, b) => a.rank - b.rank)
          .slice(0, 5);

        for (const decision of highlights) {
          if (closed) break;

          const recipient = input.recipients.find(
            (r) => r.reference === decision.recipientReference,
          );
          const exporter = input.exporters.find(
            (e) => e.reference === decision.exporterReference,
          );

          send({
            type: "decision",
            rank: decision.rank,
            date: decision.date,
            kwh: decision.kwh,
            amountPence: decision.amountPence,
            recipientLocality: recipient?.locality ?? "",
            exporterLocality: exporter?.locality ?? "",
            reasoning: decision.reasoning,
          });
          await pause();
        }

        send({
          type: "done",
          decisions: result.decisions.length,
          unserved: result.unserved,
        });
      } catch (error) {
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
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Write the run and its decisions, replacing whatever came before.
 *
 * Settlements are cleared with the old allocations, because a settlement for a
 * decision that no longer exists is a record of money moved for a reason nobody
 * can look up.
 */
async function persist(
  potId: string,
  result: ReturnType<typeof allocate>,
  seed: string,
): Promise<void> {
  const runId = `run_${result.windowStart}_${result.windowEnd}_${result.outputDigest.slice(0, 8)}`;

  await prisma.settlement.deleteMany();
  await prisma.allocationRun.deleteMany({ where: { potId } });

  await prisma.allocationRun.create({
    data: {
      id: runId,
      potId,
      seed,
      engineVersion: result.engineVersion,
      windowStart: new Date(`${result.windowStart}T00:00:00.000Z`),
      windowEnd: new Date(`${result.windowEnd}T00:00:00.000Z`),
      inputDigest: result.inputDigest,
      outputDigest: result.outputDigest,
      assessmentsJson: toJsonColumn(result.assessments),
      unservedJson: toJsonColumn(result.unserved),
      unallocatedKwh: result.unallocatedKwh,
    },
  });

  const CHUNK = 500;
  for (let offset = 0; offset < result.decisions.length; offset += CHUNK) {
    await prisma.allocation.createMany({
      data: result.decisions.slice(offset, offset + CHUNK).map((decision) => ({
        id: decision.id,
        runId,
        potId,
        exporterId: householdId(decision.exporterReference),
        recipientId: householdId(decision.recipientReference),
        kwh: decision.kwh,
        milliKwh: decision.milliKwh,
        pencePerKwh: decision.pencePerKwh,
        amountPence: decision.amountPence,
        rank: decision.rank,
        reasoningJson: toJsonColumn(decision.reasoning),
        createdAt: new Date(`${decision.date}T12:00:00.000Z`),
      })),
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
