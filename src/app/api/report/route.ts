/**
 * Solace — generate the accountability report.
 *
 * Beat five of the demonstration: one click turns the ledger into plain English
 * a councillor could take to a scrutiny committee.
 *
 * The figures are gathered from the database by ordinary code before the model
 * is called, and the generated prose is checked against them afterwards. If the
 * narrative contains a number the ledger does not support, that is returned
 * alongside it rather than hidden.
 */

import { DEMO_POT } from "@/lib/synthetic/households";
import { gatherReportFacts } from "@/lib/ai/report-facts";
import { generateReport } from "@/lib/ai/generate-report";
import { hasAnthropicKey } from "@/lib/config";
import { prisma } from "@/lib/db";
import { toJsonColumn } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const facts = await gatherReportFacts(DEMO_POT.reference);

    if (facts === null) {
      return json(
        { ok: false, error: "No pot has been set up yet." },
        { status: 404 },
      );
    }

    if (!hasAnthropicKey) {
      // The most recent stored report, if there is one. A demonstration
      // without a key should show the last thing that was generated and say
      // plainly that it is not new, rather than showing nothing.
      const previous = await prisma.report.findFirst({
        where: { pot: { reference: DEMO_POT.reference } },
        orderBy: { generatedAt: "desc" },
      });

      return json({
        ok: false,
        error:
          "No Anthropic API key is configured, so a new report cannot be written.",
        facts,
        narrative: previous?.narrative ?? null,
        generatedAt: previous?.generatedAt ?? null,
        stale: previous !== null,
      });
    }

    const outcome = await generateReport(facts);

    if (!outcome.ok || outcome.narrative === null) {
      return json({ ok: false, error: outcome.error, facts });
    }

    const pot = await prisma.pot.findUnique({
      where: { reference: DEMO_POT.reference },
    });

    if (pot !== null) {
      const generatedAt = new Date();
      await prisma.report.create({
        data: {
          id: `rep_${pot.reference.toLowerCase()}_${generatedAt.getTime()}`,
          potId: pot.id,
          periodStart: new Date(`${facts.periodStart}T00:00:00.000Z`),
          periodEnd: new Date(`${facts.periodEnd}T00:00:00.000Z`),
          generatedAt,
          narrative: outcome.narrative,
          // The exact figures the model was given, stored beside the prose so
          // any claim can be checked against what produced it.
          factsJson: toJsonColumn(facts),
          model: outcome.model,
        },
      });
    }

    return json({
      ok: true,
      narrative: outcome.narrative,
      facts,
      model: outcome.model,
      unverifiedFigures: outcome.unverifiedFigures,
      generatedAt: new Date().toISOString(),
      stale: false,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
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
