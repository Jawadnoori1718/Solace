/**
 * Solace — the demo universe.
 *
 * Three exporting households, eight recipient households, one council. That is
 * the entire world, and it is defined here as plain data so a reader can see
 * every input to the allocation engine on a single screen.
 *
 * WHY WESTMINSTER
 *
 * Because the inequality is real and it is short. Westminster contains wards
 * among the most deprived in England — Church Street, Queen's Park, Westbourne,
 * Harrow Road — within a mile or two of some of the most valuable residential
 * property in the world. A household in fuel poverty and a household exporting
 * surplus to the grid for a few pence are genuinely a few streets apart here,
 * which is the premise of this project stated as geography rather than
 * rhetoric.
 *
 * WHY THESE HOUSEHOLDS ARE ELECTRICALLY HEATED
 *
 * Most British homes heat with gas, and Solace moves electricity. The
 * households modelled here heat with electricity, which is not an evasion of
 * that problem but the point of it: electrically-heated homes are
 * disproportionately fuel-poor. Electric heating costs several times what gas
 * does per unit of heat, and in inner London it concentrates in exactly the
 * housing these households live in — flats, ex-local-authority blocks, converted
 * upper floors — where a gas connection or a boiler flue was never practical.
 * It also correlates strongly with prepayment metering.
 *
 * WHAT IS AND IS NOT REAL
 *
 * The wards are real Westminster wards, chosen so distances between them are
 * honest. Everything else — the households, their circumstances, their meter
 * readings and the case notes about them — is synthetic. No real person is
 * described anywhere in this file, no real address is used, and no real council
 * record informed it.
 *
 * The need attributes mirror the fields a council genuinely holds: benefit
 * status from its own records, EPC band from the national register, household
 * composition from council tax and housing data, and meter type from the
 * supplier. Nothing here would require new data collection to deploy.
 */

import { HouseholdRole, type EpcBand } from "../domain.ts";

/**
 * Where the pilot sits. Used for solar geometry and distances.
 *
 * Westminster is at 51.5°N, two and a bit degrees south of Leeds, which makes
 * midwinter days meaningfully longer and midsummer days shorter. The solar
 * model computes that from the latitude rather than assuming it.
 */
export const PILOT_LOCATION = {
  name: "Westminster",
  latitude: 51.4975,
  longitude: -0.1357,
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

/**
 * Three roofs, deliberately spread north, west and south of the borough.
 *
 * Rooftop solar in Westminster is constrained by conservation areas and by the
 * sheer proportion of flats, so these are the property types where it is
 * actually plausible: houses and low-rise terraces with their own roof.
 */
export const EXPORTERS: readonly ExporterDefinition[] = [
  {
    reference: "SOL-01",
    role: HouseholdRole.EXPORTER,
    displayName: "Semi-detached with rooftop array, St John's Wood",
    locality: "St John's Wood",
    latitude: 51.534,
    longitude: -0.174,
    solarCapacityKw: 4.2,
    dailyConsumptionKwh: 8.4,
  },
  {
    reference: "SOL-02",
    role: HouseholdRole.EXPORTER,
    displayName: "Terraced house with rooftop array, Little Venice",
    locality: "Little Venice",
    latitude: 51.522,
    longitude: -0.183,
    solarCapacityKw: 3.6,
    dailyConsumptionKwh: 7.1,
  },
  {
    reference: "SOL-03",
    role: HouseholdRole.EXPORTER,
    displayName: "Terraced house with rooftop array, Pimlico",
    locality: "Pimlico South",
    latitude: 51.487,
    longitude: -0.137,
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
    displayName: "Council flat, Church Street",
    locality: "Church Street",
    latitude: 51.523,
    longitude: -0.169,
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
        text: "Home visit following a referral from the health visitor. Single parent, two children under five, third floor of a block with no lift working. Electric panel heaters in the living room only; the back bedroom has no working heating and there is visible damp on the external wall. Meter went into emergency credit twice during the visit week. Parent said she tops up ten pounds at a time and turns everything off once the children are in bed. Advised on the warm homes scheme and made a referral to the local welfare assistance fund.",
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
    displayName: "Ground-floor flat, Queen's Park",
    locality: "Queen's Park",
    latitude: 51.534,
    longitude: -0.207,
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
        text: "Couple in their seventies, both retired, on pension credit. One partner has a respiratory condition and was admitted to St Mary's twice last winter; the discharge letter specifically mentions cold and damp at home. They are on a credit meter and are three hundred and forty pounds in arrears with the supplier. They have stopped heating the bedroom to keep the front room warm during the day. Referred to the affordable warmth team.",
      },
    ],
  },
  {
    reference: "REC-03",
    role: HouseholdRole.RECIPIENT,
    displayName: "Council maisonette, Westbourne",
    locality: "Westbourne",
    latitude: 51.524,
    longitude: -0.201,
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
        text: "Family of five, three children, youngest is two. Both parents working part time and receiving universal credit. Prepayment meter. They manage most weeks but told me the meter had run out on a Sunday last month and they were without power until the following morning. The maisonette itself is in reasonable repair.",
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
    displayName: "Purpose-built flat, Regent's Park",
    locality: "Regent's Park",
    latitude: 51.526,
    longitude: -0.149,
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
    displayName: "Top-floor flat, Harrow Road",
    locality: "Harrow Road",
    latitude: 51.527,
    longitude: -0.198,
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
        text: "Referred by a neighbour. Woman in her eighties living alone on the top floor of a converted terrace. Single-glazed, solid wall, electric panel heaters that she says she has not switched on since March. Wearing a coat indoors when I visited. She has a heart condition and is on the supplier's priority services register. Prepayment meter and she is self-disconnecting — she confirmed she goes without power rather than top up when the pension does not stretch. This is the most serious case on my list this month.",
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
    displayName: "Ex-local authority flat, Pimlico",
    locality: "Pimlico North",
    latitude: 51.493,
    longitude: -0.14,
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
        text: "Couple with a teenage child. One partner recently moved from full-time to reduced hours and they have started receiving universal credit. Credit meter, up to date with payments so far but told me they expect that to change over winter. Property is average for the block. Advised to contact us again if they fall behind.",
      },
    ],
  },
  {
    reference: "REC-07",
    role: HouseholdRole.RECIPIENT,
    displayName: "Adapted ground-floor flat, Vincent Square",
    locality: "Vincent Square",
    latitude: 51.495,
    longitude: -0.133,
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
    displayName: "Mansion block flat, West End",
    locality: "West End",
    latitude: 51.513,
    longitude: -0.134,
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
        text: "Enquiry about the winter fund following a community centre session. Family of four, both adults in work, no benefits in payment. The block was insulated under a previous scheme and the bills are described as manageable. No indication of hardship. Logged for completeness.",
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
  councilName: "Westminster City Council",
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
