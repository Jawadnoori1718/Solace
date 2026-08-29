/**
 * Solace — the fairness constraint.
 *
 * A pure need ranking has an ugly failure mode. The neediest household is
 * neediest on Monday, and still neediest on Tuesday, and on Wednesday, and so
 * on until the pot is empty — because receiving energy does not change its EPC
 * band, its benefit status or its health. Left alone, a need-weighted greedy
 * allocator gives everything to one home and nothing to the other seven, and
 * every individual decision is defensible while the pattern is indefensible.
 *
 * So priority decays with what a household has already received:
 *
 *     priority = need × 1 / (1 + servedKwh / HALF_LIFE_KWH)
 *
 * A household that has received nothing keeps its full need score. One that has
 * received HALF_LIFE_KWH has its priority halved, and must now be roughly twice
 * as needy as a fresh household to be chosen ahead of it.
 *
 * This does not stop a genuinely desperate household being served repeatedly —
 * which is right, because sometimes that is the correct answer. It makes each
 * repetition progressively harder to justify, and it records the arithmetic, so
 * a councillor asked "why did number five get served eleven times" has an
 * answer better than "the algorithm decided".
 */

/**
 * Energy after which a household's priority is halved, in kWh.
 *
 * A policy choice, not a measurement. Roughly five days of winter heating for a
 * poorly insulated home.
 *
 * The value is load-bearing, and getting it wrong is instructive. At 40 kWh the
 * decay was so steep that after a week the neediest household had been pushed
 * below the most comfortable one, and the least needy home in the pilot — no
 * benefits, band C, one occupant, no health condition — was receiving more than
 * a household with a prepayment meter and a cold-sensitive illness. Every
 * individual decision was correct and the distribution was indefensible.
 *
 * The constraint is meant to stop one household absorbing everything, not to
 * equalise outcomes between households whose circumstances are not equal. At
 * 150 kWh a household must receive a great deal before need stops dominating,
 * which is the intended order of priority.
 */
export const FAIRNESS_HALF_LIFE_KWH = 150;

/** The multiplier applied to a household's need score. Always in (0, 1]. */
export function fairnessMultiplier(
  servedKwh: number,
  halfLifeKwh: number = FAIRNESS_HALF_LIFE_KWH,
): number {
  if (servedKwh <= 0) return 1;
  return 1 / (1 + servedKwh / halfLifeKwh);
}

/** A plain-English account of why the multiplier is what it is. */
export function fairnessNote(
  servedKwh: number,
  timesServed: number,
  multiplier: number,
): string {
  if (servedKwh <= 0) {
    return "This household had not been served before, so its need score was applied in full.";
  }

  const reduction = Math.round((1 - multiplier) * 100);

  return (
    `This household had already received ${servedKwh.toFixed(1)} kWh across ` +
    `${timesServed} ${timesServed === 1 ? "delivery" : "deliveries"}, which reduced ` +
    `its priority by ${reduction}% so that households served less often were ` +
    `considered ahead of it.`
  );
}
