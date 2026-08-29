/**
 * Solace — the AI's second job: writing the accountability report.
 *
 * A councillor asked to account for a winter fund in committee needs sentences,
 * not a spreadsheet. This turns figures into those sentences.
 *
 * THE FIGURES ARE NOT THE MODEL'S TO SOURCE
 *
 * Every number in the report is computed from the ledger by ordinary code and
 * handed to the model as a fixed set of facts. The model writes the prose; it
 * does not query anything, does not calculate anything, and is told plainly
 * that it may not introduce a figure that is not in front of it.
 *
 * Instructions alone are not a guarantee, so the output is checked: every
 * number in the generated narrative is extracted and compared against the facts
 * it was given. Anything unaccounted for is reported alongside the report
 * rather than quietly published. A claim about public money should be checkable
 * against the arithmetic that produced it, and here it is — mechanically.
 */

import { AI_MODEL, anthropic, describeAiError } from "./client.ts";
import { formatKwh, formatPence } from "../format.ts";
import type { ReportFacts } from "../domain.ts";

const SYSTEM_PROMPT = `You write short accountability reports for UK local authority councillors about a fuel poverty fund.

Your reader is a councillor who may have to defend this spending at a scrutiny committee, to residents, or to the press. They are intelligent and busy, and they are not technical.

Rules, in order of importance:

1. Use ONLY the figures given to you. Never introduce a number that is not in the facts provided — no estimates, no projections, no national comparisons, no percentages you worked out yourself unless the percentage is given.
2. If something is not in the facts, do not mention it. Say less rather than guessing.
3. Write in British English, in plain prose. No headings, no bullet points, no markdown, no jargon, no crypto or blockchain vocabulary.
4. Three or four short paragraphs. Around 200 words.
5. Be honest about limits. If households were served repeatedly, explain why using the reasons given. If money remains, say so.
6. Do not editorialise, congratulate anyone, or describe the scheme as innovative, transformative, or a success. State what happened.

Write as the council's own record of what its money did.`;

export interface ReportOutcome {
  ok: boolean;
  narrative: string | null;
  error: string | null;
  model: string;
  /**
   * Figures appearing in the narrative that were not in the facts.
   *
   * Empty is the expected result. Anything here means the prose asserted
   * something the ledger did not support, and it is surfaced rather than
   * suppressed.
   */
  unverifiedFigures: string[];
}

/**
 * Generate the report.
 *
 * Never throws. Failure returns a described error and the interface shows it.
 */
export async function generateReport(facts: ReportFacts): Promise<ReportOutcome> {
  const client = anthropic();

  if (client === null) {
    return {
      ok: false,
      narrative: null,
      error: "No Anthropic API key is configured.",
      model: AI_MODEL,
      unverifiedFigures: [],
    };
  }

  try {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4_000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      messages: [
        {
          role: "user",
          content: `Write the accountability report for this pot.\n\n<facts>\n${describeFacts(facts)}\n</facts>`,
        },
      ],
    });

    const narrative = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (narrative === "") {
      return {
        ok: false,
        narrative: null,
        error: `The model returned no text (stop reason: ${response.stop_reason}).`,
        model: AI_MODEL,
        unverifiedFigures: [],
      };
    }

    return {
      ok: true,
      narrative,
      error: null,
      model: AI_MODEL,
      unverifiedFigures: findUnverifiedFigures(narrative, facts),
    };
  } catch (error) {
    return {
      ok: false,
      narrative: null,
      error: describeAiError(error),
      model: AI_MODEL,
      unverifiedFigures: [],
    };
  }
}

/**
 * The facts, written out for the model.
 *
 * Presented as prose rather than JSON because the model writes better prose
 * from prose, and because a human reviewing what the model was told should be
 * able to read it without parsing anything.
 */
export function describeFacts(facts: ReportFacts): string {
  const lines = [
    `Council: ${facts.councilName}`,
    `Pot: ${facts.potName} (reference ${facts.potReference})`,
    `Funding stream: ${facts.fundingSource}`,
    `Period: ${facts.periodStart} to ${facts.periodEnd}`,
    "",
    `Deposited into the pot: ${formatPence(facts.depositedPence)}`,
    `Spent: ${formatPence(facts.spentPence)}`,
    `Remaining: ${formatPence(facts.remainingPence)}`,
    "",
    `Energy delivered: ${formatKwh(facts.totalKwh)}`,
    `Households that received energy: ${facts.householdsServed}`,
    `Average per household: ${formatKwh(facts.averageKwhPerHousehold)}, worth ${formatPence(facts.averagePencePerHousehold)}`,
    "",
    `Settlements confirmed on a public ledger: ${facts.confirmedOnChainCount}`,
  ];

  if (facts.backfilledCount > 0) {
    lines.push(
      `Historic records with no transaction behind them: ${facts.backfilledCount}`,
    );
  }

  if (facts.repeatRecipients.length > 0) {
    lines.push("", "Households served more than once, and why:");
    for (const repeat of facts.repeatRecipients) {
      lines.push(
        `- A household in ${repeat.locality} (reference ${repeat.reference}) was served ${repeat.timesServed} times, receiving ${formatKwh(repeat.kwhReceived)} in total. ${repeat.reason}`,
      );
    }
  } else {
    lines.push("", "No household was served more than once.");
  }

  return lines.join("\n");
}

/**
 * Find numbers in the narrative that the facts do not support.
 *
 * Deliberately conservative about what counts as a violation. Small integers
 * are ignored, because "three paragraphs" and "two of the eight" are ordinary
 * English rather than claims about money, and flagging them would bury a real
 * discrepancy in noise. Percentages and money figures are checked hard, because
 * those are the sentences that get quoted.
 */
export function findUnverifiedFigures(
  narrative: string,
  facts: ReportFacts,
): string[] {
  const permitted = new Set<string>();

  const permit = (value: number): void => {
    if (!Number.isFinite(value)) return;
    // Every rounding a writer might reasonably apply to the same quantity.
    permitted.add(String(value));
    permitted.add(String(Math.round(value)));
    permitted.add(value.toFixed(1));
    permitted.add(value.toFixed(2));
    permitted.add(Math.round(value).toLocaleString("en-GB"));
  };

  const permitMoney = (pence: number): void => {
    permit(pence);
    permit(pence / 100);
  };

  permitMoney(facts.depositedPence);
  permitMoney(facts.spentPence);
  permitMoney(facts.remainingPence);
  permitMoney(facts.averagePencePerHousehold);

  permit(facts.totalKwh);
  permit(facts.householdsServed);
  permit(facts.averageKwhPerHousehold);
  permit(facts.confirmedOnChainCount);
  permit(facts.backfilledCount);
  permit(facts.repeatRecipients.length);

  // Percentages the facts genuinely support.
  if (facts.depositedPence > 0) {
    permit((facts.spentPence / facts.depositedPence) * 100);
    permit((facts.remainingPence / facts.depositedPence) * 100);
  }

  for (const repeat of facts.repeatRecipients) {
    permit(repeat.timesServed);
    permit(repeat.kwhReceived);
  }

  // Years and dates in the period are legitimate and are not quantities.
  for (const token of [facts.periodStart, facts.periodEnd, facts.potReference]) {
    for (const match of token.matchAll(/\d+/g)) permitted.add(match[0]);
  }

  const unverified: string[] = [];

  for (const match of narrative.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = match[0];
    const cleaned = raw.replace(/,/g, "");
    const value = Number(cleaned);

    if (!Number.isFinite(value)) continue;

    // Small counts are ordinary prose, not financial claims.
    if (Number.isInteger(value) && value <= 12) continue;

    if (
      permitted.has(cleaned) ||
      permitted.has(raw) ||
      permitted.has(String(value)) ||
      permitted.has(value.toFixed(1)) ||
      permitted.has(value.toFixed(2))
    ) {
      continue;
    }

    unverified.push(raw);
  }

  return [...new Set(unverified)];
}
