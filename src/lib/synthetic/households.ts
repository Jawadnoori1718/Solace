/**
 * Solace — the demo universe.
 *
 * Three exporting households, eight recipient households, one council. That is
 * the entire world, and it is defined here as plain data so a reader can see
 * every input to the allocation engine on a single screen.
 *
 * WHY THESE HOUSEHOLDS ARE ELECTRICALLY HEATED
 *
 * Most British homes heat with gas, and Solace moves electricity. The households
 * modelled here heat with electricity, which is not an evasion of that problem
 * but the point of it: electrically-heated homes are disproportionately
 * fuel-poor. Electric heating costs several times what gas does per unit of
 * heat, it is concentrated in flats, older terraces and homes off the gas grid,
 * and it correlates strongly with prepayment metering. These are precisely the
 * households a winter support fund is trying to reach, and precisely the ones a
 * delivered kilowatt-hour helps most.
 *
 * WHAT IS AND IS NOT REAL
 *
 * The localities are real Leeds neighbourhoods, chosen so distances and travel
 * between them are honest. Everything else — the households, their
 * circumstances, their meter readings and the case notes about them — is
 * synthetic. No real person is described anywhere in this file, and no real
 * council record informed it.
 *
 * The need attributes mirror the fields a council genuinely holds: benefit
 * status from its own records, EPC band from the national register, household
 * composition from council tax and housing data, and meter type from the
 * supplier. Nothing here would require new data collection to deploy.
 */

import { HouseholdRole, type EpcBand } from "../domain.ts";

/** Where the pilot sits. Used for solar geometry and distances. */
export const PILOT_LOCATION = {
  name: "Leeds",
  latitude: 53.7997,
  longitude: -1.5492,
} as const;

export interface ExporterDefinition {
  reference: string;
  role: typeof HouseholdRole.EXPORTER;
  displayName: string;
  locality: string;
  latitude: number;
  longitude: number;
  /** Installed peak capacity of the array, in kW. */
  solarCapacityKw: number;
  /** Typical daily consumption, in kWh. Surplus is generation minus this. */
  dailyConsumptionKwh: number;
}

export interface CaseNote {
  /** How many days before the seed's end date the note was written. */
  daysAgo: number;
  /** The note as an officer would have typed it, in their own words. */
  text: string;
}

export interface RecipientDefinition {
  reference: string;
  role: typeof HouseholdRole.RECIPIENT;
  displayName: string;
  locality: string;
  latitude: number;
  longitude: number;

  onMeansTestedBenefit: boolean;
  epcBand: EpcBand;
  occupants: number;
  hasChildUnderFive: boolean;
  hasResidentOverSixtyFive: boolean;
  hasHealthCondition: boolean;
  onPrepaymentMeter: boolean;

  /** Expected daily consumption in cold weather, in kWh. */
  coldWeatherBaselineKwh: number;

  /**
   * How strongly this household rations electricity when money is short,
   * from 0 (never) to 1 (severely).
   *
   * This is not a council-held field. It is a generator parameter that shapes
   * the synthetic consumption series so that rationing appears in the data as
   * it would in reality — as consumption falling below what the weather says it
   * should be. The engine detects that pattern from the readings; it never sees
   * this number.
   */
  rationingTendency: number;

  caseNotes: CaseNote[];
}

// ---------------------------------------------------------------------------
// Exporting households
// ---------------------------------------------------------------------------

export const EXPORTERS: readonly ExporterDefinition[] = [
  {
    reference: "SOL-01",
    role: HouseholdRole.EXPORTER,
    displayName: "Semi-detached with rooftop array, Adel",
    locality: "Adel",
    latitude: 53.848,
    longitude: -1.586,
    solarCapacityKw: 4.2,
    dailyConsumptionKwh: 8.4,
  },
  {
    reference: "SOL-02",
    role: HouseholdRole.EXPORTER,
    displayName: "Detached with rooftop array, Horsforth",
    locality: "Horsforth",
    latitude: 53.8367,
    longitude: -1.635,
    solarCapacityKw: 3.6,
    dailyConsumptionKwh: 7.1,
  },
  {
    reference: "SOL-03",
    role: HouseholdRole.EXPORTER,
    displayName: "Detached with rooftop array, Roundhay",
    locality: "Roundhay",
    latitude: 53.833,
    longitude: -1.498,
    solarCapacityKw: 5.0,
    dailyConsumptionKwh: 9.8,
  },
] as const;

// ---------------------------------------------------------------------------
// Recipient households
// ---------------------------------------------------------------------------

/**
 * Eight households spanning a deliberate range of need.
 *
 * They are not all equally deserving, and that is the point. An allocation
 * engine that ranks eight identical households proves nothing. These differ in
 * benefit status, building condition, composition, health and meter type, so
 * the ranking the engine produces is a real judgement that can be argued with.
 */
export const RECIPIENTS: readonly RecipientDefinition[] = [
  {
    reference: "REC-01",
    role: HouseholdRole.RECIPIENT,
    displayName: "Back-to-back terrace, Armley",
    locality: "Armley",
    latitude: 53.796,
    longitude: -1.592,
    onMeansTestedBenefit: true,
    epcBand: "F",
    occupants: 3,
    hasChildUnderFive: true,
    hasResidentOverSixtyFive: false,
    hasHealthCondition: false,
    onPrepaymentMeter: true,
    coldWeatherBaselineKwh: 26,
    rationingTendency: 0.72,
    caseNotes: [
      {
        daysAgo: 22,
        text: "Home visit following a referral from the health visitor. Single parent, two children under five. Storage heaters in the front room only; back bedroom has no working heating and there is visible damp on the external wall. Meter went into emergency credit twice during the visit week. Parent said they top up £10 at a time and turn everything off once the children are in bed. Advised on the warm homes scheme and made a referral to the local welfare assistance fund.",
      },
      {
        daysAgo: 6,
        text: "Follow-up call. Situation unchanged. Said she has been putting the heating on for an hour before the children's bath and then switching it off for the rest of the evening. Asked whether the support would arrive before the weather turns.",
      },
    ],
  },
  {
    reference: "REC-02",
    role: HouseholdRole.RECIPIENT,
    displayName: "Ground-floor flat, Beeston",
    locality: "Beeston",
    latitude: 53.772,
    longitude: -1.562,
    onMeansTestedBenefit: true,
    epcBand: "E",
    occupants: 2,
    hasChildUnderFive: false,
    hasResidentOverSixtyFive: true,
    hasHealthCondition: true,
    onPrepaymentMeter: false,
    coldWeatherBaselineKwh: 24,
    rationingTendency: 0.55,
    caseNotes: [
      {
        daysAgo: 17,
        text: "Couple in their seventies, both retired, on pension credit. One partner has a respiratory condition and was hospitalised twice last winter; the discharge letter specifically mentions cold and damp at home. They are on a credit meter and are £340 in arrears with the supplier. They have stopped heating the bedroom to keep the living room warm during the day. Referred to the affordable warmth team.",
      },
    ],
  },
  {
    reference: "REC-03",
    role: HouseholdRole.RECIPIENT,
    displayName: "Mid-terrace, Harehills",
    locality: "Harehills",
    latitude: 53.809,
    longitude: -1.514,
    onMeansTestedBenefit: true,
    epcBand: "D",
    occupants: 5,
    hasChildUnderFive: true,
    hasResidentOverSixtyFive: false,
    hasHealthCondition: false,
    onPrepaymentMeter: true,
    coldWeatherBaselineKwh: 31,
    rationingTendency: 0.6,
    caseNotes: [
      {
        daysAgo: 28,
        text: "Family of five, three children, youngest is two. Both parents working part time and receiving universal credit. Prepayment meter. They manage most weeks but told me the meter had run out on a Sunday last month and they were without power until the following morning. The property itself is in reasonable repair.",
      },
      {
        daysAgo: 11,
        text: "Contacted the office about school uniform costs. Mentioned in passing that they have been leaving the immersion heater off and boiling kettles for washing.",
      },
    ],
  },
  {
    reference: "REC-04",
    role: HouseholdRole.RECIPIENT,
    displayName: "Purpose-built flat, Gipton",
    locality: "Gipton",
    latitude: 53.811,
    longitude: -1.489,
    onMeansTestedBenefit: false,
    epcBand: "C",
    occupants: 1,
    hasChildUnderFive: false,
    hasResidentOverSixtyFive: false,
    hasHealthCondition: false,
    onPrepaymentMeter: false,
    coldWeatherBaselineKwh: 14,
    rationingTendency: 0.12,
    caseNotes: [
      {
        daysAgo: 19,
        text: "Self-referral after seeing the winter support leaflet. Single occupant, working full time, not receiving any benefits. Flat is well insulated and was refurbished three years ago. No arrears and no difficulty reported paying the bill. Signposted to general energy efficiency advice. No further action proposed at this stage.",
      },
    ],
  },
  {
    reference: "REC-05",
    role: HouseholdRole.RECIPIENT,
    displayName: "Top-floor flat, Holbeck",
    locality: "Holbeck",
    latitude: 53.786,
    longitude: -1.557,
    onMeansTestedBenefit: true,
    epcBand: "G",
    occupants: 1,
    hasChildUnderFive: false,
    hasResidentOverSixtyFive: true,
    hasHealthCondition: true,
    onPrepaymentMeter: true,
    coldWeatherBaselineKwh: 22,
    rationingTendency: 0.85,
    caseNotes: [
      {
        daysAgo: 25,
        text: "Referred by a neighbour. Woman in her eighties living alone on the top floor. Single-glazed, solid wall, electric panel heaters that she says she has not switched on since March. Wearing a coat indoors when I visited. She has a heart condition and is on the supplier's priority services register. Prepayment meter and she is self-disconnecting — she confirmed she goes without power rather than top up when the pension does not stretch. This is the most serious case on my list this month.",
      },
      {
        daysAgo: 9,
        text: "Warm home discount application submitted on her behalf. She declined a food parcel. Told me she does not want to be a nuisance. Flagged for priority contact when the winter fund opens.",
      },
    ],
  },
  {
    reference: "REC-06",
    role: HouseholdRole.RECIPIENT,
    displayName: "Mid-terrace, Hunslet",
    locality: "Hunslet",
    latitude: 53.777,
    longitude: -1.533,
    onMeansTestedBenefit: true,
    epcBand: "D",
    occupants: 3,
    hasChildUnderFive: false,
    hasResidentOverSixtyFive: false,
    hasHealthCondition: false,
    onPrepaymentMeter: false,
    coldWeatherBaselineKwh: 21,
    rationingTendency: 0.34,
    caseNotes: [
      {
        daysAgo: 14,
        text: "Couple with a teenage child. One partner recently moved from full-time to reduced hours and they have started receiving universal credit. Credit meter, up to date with payments so far but told me they expect that to change over winter. Property is average for the street. Advised to contact us again if they fall behind.",
      },
    ],
  },
  {
    reference: "REC-07",
    role: HouseholdRole.RECIPIENT,
    displayName: "Adapted ground-floor flat, Burmantofts",
    locality: "Burmantofts",
    latitude: 53.802,
    longitude: -1.523,
    onMeansTestedBenefit: true,
    epcBand: "E",
    occupants: 1,
    hasChildUnderFive: false,
    hasResidentOverSixtyFive: false,
    hasHealthCondition: true,
    onPrepaymentMeter: true,
    coldWeatherBaselineKwh: 25,
    rationingTendency: 0.68,
    caseNotes: [
      {
        daysAgo: 20,
        text: "Adult living alone, limited mobility, uses powered equipment at home which cannot be switched off. Receives personal independence payment and universal credit. Prepayment meter, which is the wrong tariff arrangement entirely for a household with equipment that has to stay on. Reported going without hot water for several days in July to keep the meter in credit. Referred to the supplier for a meter change and to the priority services register.",
      },
    ],
  },
  {
    reference: "REC-08",
    role: HouseholdRole.RECIPIENT,
    displayName: "Semi-detached, Seacroft",
    locality: "Seacroft",
    latitude: 53.824,
    longitude: -1.457,
    onMeansTestedBenefit: false,
    epcBand: "C",
    occupants: 4,
    hasChildUnderFive: false,
    hasResidentOverSixtyFive: false,
    hasHealthCondition: false,
    onPrepaymentMeter: false,
    coldWeatherBaselineKwh: 18,
    rationingTendency: 0.15,
    caseNotes: [
      {
        daysAgo: 12,
        text: "Enquiry about the winter fund following a community centre session. Family of four, both adults in work, no benefits in payment. Home was insulated under a previous scheme and the bills are described as manageable. No indication of hardship. Logged for completeness.",
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// The council
// ---------------------------------------------------------------------------

/**
 * The pot the demonstration runs against.
 *
 * £400 is sized to the physics, not chosen for effect. Three rooftop arrays
 * produce roughly 870 kWh of surplus across a month, worth about £244 at the
 * stated tariff. A pot much larger than that would sit almost untouched for the
 * whole pilot, and a dashboard showing a balance that never moves would be
 * telling the truth in a way that conveys nothing.
 *
 * A real Household Support Fund allocation runs to millions across tens of
 * thousands of homes. The figure that scales is not the pot; it is the property
 * that every pound of it can be followed.
 */
export const DEMO_POT = {
  id: "pot_winter_2026",
  reference: "WINTER-2026",
  name: "Winter Support Pot 2026",
  councilName: "Leeds City Council",
  fundingSource: "Household Support Fund",
  openingDepositPence: 40_000,
  depositReference: "HSF/2026/0417",
} as const;

/** Every household, exporters first. */
export function allHouseholds(): ReadonlyArray<
  ExporterDefinition | RecipientDefinition
> {
  return [...EXPORTERS, ...RECIPIENTS];
}

/** Stable database identifier for a household reference. */
export function householdId(reference: string): string {
  return `hh_${reference.toLowerCase().replace("-", "_")}`;
}
