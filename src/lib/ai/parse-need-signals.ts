/**
 * Solace — the AI's first job: reading council case notes.
 *
 * A council officer writes what they saw in prose: "wearing a coat indoors",
 * "meter went into emergency credit twice", "declined a food parcel". None of
 * that is a database field, and no council is going to restructure a decade of
 * case management to make it one. Turning that prose into a number a solver can
 * use is genuinely a language problem, and it is the one place in Solace where
 * a language model earns its place.
 *
 * WHERE THE BOUNDARY IS
 *
 * This runs ONCE per case note. The result is written to the database, and the
 * allocation engine later reads a column. By the time a score reaches the
 * engine it is a number between zero and one, indistinguishable from any other
 * — the engine cannot tell a model was involved and has no way to call one.
 *
 * That is what keeps the reproducibility claim honest. The engine is
 * deterministic given the database state, and the model's contribution is a
 * stored, inspectable, re-checkable input rather than a live judgement made
 * during allocation. Re-running the parser and re-running the engine are two
 * separate, auditable acts.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { AI_MODEL, PARSER_VERSION, anthropic, describeAiError } from "./client.ts";
import type { ParsedNeedSignal } from "../domain.ts";

/**
 * The schema the model must produce, enforced by the API rather than hoped for.
 *
 * `strict: true` with `additionalProperties: false` means the tool input is
 * validated against this before it reaches us. A malformed extraction is a
 * failed request, not a runtime surprise three layers down.
 */
const ASSESSMENT_TOOL: Anthropic.Tool = {
  name: "record_need_assessment",
  description:
    "Record a structured assessment of a household's vulnerability to cold, based only on what the case note actually says.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      vulnerabilityScore: {
        type: "number",
        description:
          "How vulnerable to cold this household is, from 0 to 1. 0 means no indication of difficulty. 1 means severe and immediate risk. Base this only on what the note says.",
      },
      indicators: {
        type: "array",
        description:
          "Short machine-readable markers for what the note evidences. Use only markers from the permitted list.",
        items: {
          type: "string",
          enum: [
            "self_disconnection",
            "emergency_credit",
            "rationing_heating",
            "rationing_hot_water",
            "damp_or_mould",
            "inadequate_heating_system",
            "arrears",
            "health_condition_cold_sensitive",
            "priority_services_register",
            "young_children",
            "older_resident",
            "disability_or_mobility",
            "medical_equipment_dependency",
            "recent_income_shock",
            "no_indication_of_hardship",
          ],
        },
      },
      urgent: {
        type: "boolean",
        description:
          "True only if the note describes an immediate risk to health or safety, rather than a standing difficulty.",
      },
      rationale: {
        type: "string",
        description:
          "One sentence, in British English, explaining the score. It must refer only to what the note says.",
      },
      confidence: {
        type: "number",
        description:
          "How confident this assessment is, from 0 to 1. Score low when the note is brief, ambiguous, or second-hand.",
      },
    },
    required: [
      "vulnerabilityScore",
      "indicators",
      "urgent",
      "rationale",
      "confidence",
    ],
    additionalProperties: false,
  },
};

/**
 * The instructions.
 *
 * Two things in here matter more than the rest. The model is told to score only
 * what the note says — not to infer hardship from a neighbourhood, a name or
 * anything else it might associate — and it is told that a note describing no
 * difficulty should score low. A parser that finds vulnerability everywhere is
 * useless for ranking, and would quietly hand support to whoever wrote the
 * longest note.
 */
const SYSTEM_PROMPT = `You read case notes written by UK local authority officers about households at risk of fuel poverty, and turn them into a structured assessment.

Your assessment feeds a deterministic allocation engine that decides which households receive support from a council's winter fund. You do not make that decision and you cannot see it. Your only job is to state, faithfully, what the note evidences.

How to score:

- Score ONLY what the note says. Never infer hardship from a place name, a property type, or anything not written down. If the note describes no difficulty, say so with a low score — that is a useful and correct answer.
- 0.0 to 0.2: the note indicates no meaningful difficulty.
- 0.2 to 0.5: some financial pressure, but the household is coping and the home is adequately heated.
- 0.5 to 0.8: the household is rationing energy, in arrears, or living in a poorly heated home.
- 0.8 to 1.0: the household is going without heat or power, or cold is actively endangering someone's health.
- Set "urgent" true only for an immediate risk to health or safety, not for a standing difficulty.
- Set "confidence" low when the note is short, vague, or reports something second-hand.
- Write the rationale in British English, in one sentence, referring only to the note's own content.

You are assessing a household's circumstances, not a person's character. Do not speculate beyond the text.`;

export interface ParseOutcome {
  ok: boolean;
  parsed: ParsedNeedSignal | null;
  error: string | null;
  model: string;
  parserVersion: string;
}

/**
 * Parse one case note.
 *
 * Never throws. A failure returns a described error so a batch can continue and
 * the interface can report what went wrong.
 */
export async function parseCaseNote(caseNote: string): Promise<ParseOutcome> {
  const client = anthropic();

  if (client === null) {
    return {
      ok: false,
      parsed: null,
      error: "No Anthropic API key is configured.",
      model: AI_MODEL,
      parserVersion: PARSER_VERSION,
    };
  }

  try {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4_000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      tools: [ASSESSMENT_TOOL],
      // Force the extraction. A prose reply here would be a failure, not an
      // answer, and there is nothing useful to do with one.
      tool_choice: { type: "tool", name: "record_need_assessment" },
      messages: [
        {
          role: "user",
          content: `Assess this case note.\n\n<case_note>\n${caseNote}\n</case_note>`,
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUse === undefined) {
      return {
        ok: false,
        parsed: null,
        error: `The model returned no assessment (stop reason: ${response.stop_reason}).`,
        model: AI_MODEL,
        parserVersion: PARSER_VERSION,
      };
    }

    const parsed = normalise(toolUse.input as Record<string, unknown>);

    return {
      ok: true,
      parsed,
      error: null,
      model: AI_MODEL,
      parserVersion: PARSER_VERSION,
    };
  } catch (error) {
    return {
      ok: false,
      parsed: null,
      error: describeAiError(error),
      model: AI_MODEL,
      parserVersion: PARSER_VERSION,
    };
  }
}

/**
 * Clamp and tidy the model's output before it is stored.
 *
 * The schema guarantees the shape; it does not guarantee that a number the
 * model called a score is inside the range the engine expects. A value of 1.4
 * would sail through validation and quietly distort every ranking afterwards,
 * so the bounds are enforced here, at the point the value enters our system.
 */
function normalise(input: Record<string, unknown>): ParsedNeedSignal {
  const clamp01 = (value: unknown): number => {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(1, Math.max(0, number));
  };

  return {
    vulnerabilityScore: round3(clamp01(input.vulnerabilityScore)),
    indicators: Array.isArray(input.indicators)
      ? input.indicators.filter((item): item is string => typeof item === "string")
      : [],
    urgent: input.urgent === true,
    rationale: typeof input.rationale === "string" ? input.rationale.trim() : "",
    confidence: round3(clamp01(input.confidence)),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
