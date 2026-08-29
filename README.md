# Solace

**An accountability layer for fuel poverty spending.**

> This README is being written alongside the build. Sections marked _(to come)_
> are filled in as the phases they describe are completed.

---

## The problem

UK councils and charities distribute fuel poverty support — Household Support
Fund grants, ECO4 measures, Warm Home Discount top-ups — as vouchers and BACS
payments. Once the money leaves the council, it becomes very difficult to say
where it landed or what it bought. A councillor who signs off half a million
pounds of winter support cannot easily tell a scrutiny committee which
households were warmer as a result.

At the same time, a household with rooftop solar exports its surplus to the grid
for a few pence per unit, while a family three streets away sits in the cold.

Solace routes that surplus to households in need, settles it instantly in a
GBP-denominated token, and writes every movement to a public ledger. A
councillor deposits into a winter pot and sees, in real time and in plain
English, exactly which kilowatt-hours reached which household.

This is not an energy trading product. It is public-sector accountability
infrastructure that happens to move electricity.

---

## Architecture

Solace is four layers. The separation between the second and the fourth is the
important one.

### Layer 1 — Signal

Half-hourly meter data for three exporting households and eight recipient
households, across thirty days.

**This data is simulated, and the interface says so wherever it appears.** We
have no smart meter access and do not imply otherwise. The integration path for
a real deployment is the Data Communications Company and supplier APIs, which
expose exactly this shape.

It is simulated carefully rather than sketched. Generation comes from real solar
geometry — declination, hour angle, air mass, the equation of time — so day
length and the shape of the morning ramp are right for the latitude and the
date. Weather is autocorrelated, so cloudy spells last rather than flicker every
thirty minutes. Consumption is a base load that scales with occupancy plus a
heating load driven by the actual temperature, calibrated per household.

Most importantly, **fuel poverty is present in the readings rather than asserted
alongside them**. A household that cannot afford heat consumes less than the
weather says it should, and a prepayment meter that runs out goes dark for
hours. Both appear in the generated data, and the allocation engine detects them
from the readings alone. In the seeded month, the four prepayment households
show sustained multi-hour spells below a quarter of their own median
consumption; the credit-meter households show none.

Every value derives from a single seed string. Running the seed twice produces
byte-identical data, which is what makes the engine's reproducibility claim
checkable rather than merely stated.

### Layer 2 — Allocation

A deterministic, reproducible solver. Given the same input it produces
byte-identical output, and every decision can be replayed and explained from
that input alone.

**No language model participates in deciding who receives energy.** The engine
is a pure function: no database, no network, no clock, no model, and no random
number that is not derived from the run's published seed.

**How a household is scored.** Nine factors, each normalised to 0–1, each
multiplied by a fixed published weight, and summed. The weights are a policy
position and are stated as such — a council adopting Solace would set them
through the same committee that signs off its fuel poverty strategy.

| Factor | Weight |
| --- | --- |
| Means-tested benefit | 0.16 |
| Consumption below weather-adjusted expectation | 0.16 |
| EPC band | 0.14 |
| Health condition worsened by cold | 0.12 |
| Council case notes | 0.10 |
| Prepayment meter | 0.10 |
| Resident over 65 | 0.09 |
| Child under five | 0.07 |
| Evenings without supply | 0.06 |

Where a factor cannot be evaluated — most often because no case note has been
parsed — it is dropped and the remaining weights are scaled back up. A household
is never penalised for a gap in the council's records.

**Three constraints bind the solver.**

*Proximity.* A recipient must be within 8 km of the exporting household.

*Concurrent demand.* A household is only matched against surplus it could
actually have used at that moment. Energy generated at two in the afternoon
cannot warm a house at eight in the evening without storage, and this pilot has
none. This makes the numbers smaller and the claim true.

*Fairness.* Priority decays with what a household has already received:
`priority = need ÷ (1 + servedKwh / 150)`. Without it, the neediest household is
neediest again tomorrow and every day after, and a need-weighted allocator hands
everything to one home while every individual decision remains defensible.

**Eligibility is a published threshold, and it exists because the data demanded
it.** Surplus is scarce across a month but not within a sunny afternoon — at
midday three arrays produce more than nearby households are drawing, so ranking
decided only the *order* households were served in, not *whether* they were.
A comfortable household with no benefits and a band C flat was receiving fuel
poverty support alongside a pensioner self-disconnecting on a prepayment meter.
That is a question about who a fund is for, and every real fund answers it. A
need score below 0.35 is not eligible; the number is a single published constant
a council can move.

**Every decision carries its reasoning** — each factor, its raw value, its
weight and its contribution — so a reader can check the arithmetic rather than
take the total on trust. Households that received nothing get a stated reason
too. A system that explains only its positive decisions cannot answer the
question it will actually be asked.

**Reproducibility is attested, not asserted.** Every run stores a SHA-256 digest
of its canonicalised input and output. Re-run the engine on the same input and
both digests must match. The test suite holds it to that, including against
inputs built in a different key order and with households listed in a different
sequence.

### Layer 3 — Settlement

`SolacePound` (`SLP`) is an ERC-20 token deployed to the Base Sepolia public
testnet. Two things about it are worth knowing.

**It is denominated in pounds, not in the customary 18 decimals.** `decimals` is
2, so one SLP is one pound and the smallest unit is one penny. Every amount in
this system starts life as an integer number of pence in the council's ledger,
so a two-decimal token maps to it exactly, with no scaling and no rounding. A
block explorer shows `2,500.00 SLP` against a pot the council funded with
£2,500.00, and the two figures are the same figure.

**Each allocation calls `settle()`, not `transfer()`.** A bare ERC-20 transfer
can only say that an amount moved between two addresses. `settle()` emits an
`AllocationSettled` event carrying the energy delivered in milli-kWh, the
amount, the pot reference, the timestamp and the hashed recipient — so the
public record states what the money bought, not merely that it moved.

The contract also enforces the constraint that matters most: **a pot cannot be
overdrawn.** That rule lives on chain rather than in the application, so it
holds even if our own code has a bug.

**Every allocation becomes one transaction.** The settlement service writes the
local record *before* sending the transaction, so a transaction that succeeds on
chain while the process dies still leaves evidence behind. A settlement with no
local record would be money that moved with nothing to explain it, which is the
exact failure Solace exists to prevent.

**Settlement never throws.** A failure is recorded against the allocation with
its reason and the run continues. A settlement run that stops dead on the first
bad transaction is useless on a stage, and parliamentary wifi is not a
dependency this demonstration can afford.

**The ledger is checked against the chain.** After settling, the pot balance is
computed twice by entirely different means — once by summing database rows, once
by reading contract storage — and the two are compared. In the seeded run both
report £295.19 against a £400 pot, from 292 confirmed transactions delivering
374.3 kWh.

### Layer 4 — Councillor dashboard

A single page, civic in tone. It is meant to look like something a councillor
could print and take to a scrutiny committee, not like a financial product.

The headline is what remains in the pot, because that is the question being
asked. Around it: energy delivered, households reached out of households
assessed, settlements confirmed on chain, and what the same kilowatt-hours would
have earned had they been exported to the grid instead — the gap Solace closes,
stated as a number.

**Households are ordered by the share of their electricity Solace covered, not
by raw kilowatt-hours.** A five-person terrace absorbs far more energy than a
single pensioner in a flat, so absolute figures flatter large households and
understate what a delivery meant to a small one. Households that received
nothing appear in the list too. A dashboard that lists only the served
households cannot answer the question a councillor will actually ask.

Three provenance notes sit at the foot of every page — what the meter data is,
what reaches the chain, and what `SolacePound` is. Solace's argument is that a
system handling public money should say what it knows and what it does not, and
that has to be on the page rather than buried in a repository.

The palette was validated rather than chosen by eye: worst adjacent contrast
under simulated colour-vision deficiency is ΔE 22.1 against a floor of 8, and
ΔE 28.1 for normal vision against a floor of 15.

**Every allocation opens to show its reasoning** — each factor, its raw value,
its published weight, and what it contributed, so a reader can add up the column
and arrive at the total themselves. That is the difference between an
explanation and an assertion.

**Settlement runs live.** Pressing "Settle now" opens a stream that settles
pending allocations one at a time while the balance counts down. Each row
appears only after its transaction has been mined and its receipt confirmed —
the feed reports the chain, it does not anticipate it. The only artifice is a
pause between settlements so a person can follow them; on a local chain they
otherwise complete in about four milliseconds each.

**Households that received nothing get their own panel**, with the engine's
reason in its own words and the need score that produced it. The run's
assessment of every household is stored, not just the ones it served, because a
system that explains only its positive decisions cannot answer the question it
will actually be asked.

---

## Where the AI is, and where it is not

The Anthropic API does exactly two jobs:

1. **Parsing messy need signals.** Free-text council case notes are turned into
   structured need scores. This happens once, and the structured result is
   persisted to the database.
2. **Writing the accountability narrative.** Ledger figures computed by ordinary
   code are turned into the plain English a councillor could take to a scrutiny
   committee.

The allocation engine reads only the persisted, structured fields. It never
calls a model. The model interprets inputs and describes outcomes; it does not
decide who gets what.

This boundary is what keeps the reproducibility claim honest. The engine is
deterministic given the database state, and the model's contribution is a
stored, inspectable, re-checkable input rather than a live judgement made during
allocation.

**The separation is tested, not promised.** A test reads every file under
`src/lib/engine/` and asserts that none of them imports the AI layer or the
Anthropic SDK, constructs a client, calls `fetch`, imports a network module,
reads the clock, or uses `Math.random`. If somebody later wires a model into the
solver, the suite fails.

**Parsing.** A council officer writes what they saw — *"wearing a coat
indoors"*, *"meter went into emergency credit twice"*. None of that is a
database field, and no council will restructure a decade of case management to
make it one. The model turns it into a vulnerability score, a set of indicators
and a one-line rationale, using strict tool use so the API validates the shape
before it reaches us. It is told to score only what the note says, and that a
note describing no difficulty should score low — a parser that finds
vulnerability everywhere is useless for ranking.

**The report cannot invent a figure.** Every number is computed from the ledger
by ordinary code and handed to the model as a fixed set of facts. Instructions
alone are not a guarantee, so the output is checked: every number in the
generated prose is extracted and compared against the facts it was given, and
anything unaccounted for is displayed alongside the report rather than quietly
published. The dashboard states the result either way — *"Every figure in this
report was checked against the ledger it was generated from."*

Without an API key, both jobs degrade rather than fail: the engine drops the
case-note factor and renormalises the rest, so a household is never penalised
for a gap in the council's records, and the report falls back to the most recent
stored version, labelled as such.

---

## What the data showed us

Building the simulation properly surfaced something we would rather state than
have someone discover. Across the seeded month, three rooftop arrays produce
**873 kWh of surplus, worth about £244** — enough to cover roughly a third of
the eight recipient households' demand.

Run the same simulation over a January window and surplus collapses to **37.7
kWh, worth £10.55, against 4,886 kWh of demand**. That is not a bug. It is
British winter: the sun is low, the days are short, and the exporting households
use most of what little they generate.

So the naive framing — route winter solar surplus to fuel-poor homes in winter —
does not physically work. Surplus is abundant in summer and absent in January,
while need runs the other way.

What does work is routing surplus whenever it exists and **tracking the credit
until it is needed**. That makes the ledger the essential component rather than
a nice-to-have: if value is banked in July and spent in January, something has
to hold an auditable record of whose surplus it was, who received it, and what
remains. That record is what Solace actually is.

The pot is sized to match. £400 across a month-long pilot is proportionate to
£244 of surplus. A real Household Support Fund allocation runs to millions
across tens of thousands of homes; the thing that scales is not the pot but the
property that every pound of it can be followed.

---

## Privacy

**No personal data is ever written on chain.**

Recipients appear on chain only as an HMAC-SHA256 of an internal household
reference, computed under a secret salt held in `.env.local` and never
committed. The mapping from that hash back to a household exists only in the
local database.

The salt matters. This universe contains eleven households, so an unsalted hash
of a household reference could be brute-forced by anyone in seconds. A keyed
HMAC under a secret salt is what makes the on-chain identifier genuinely opaque.

What reaches the chain: a quantity of energy, an amount, a timestamp, a pot
reference, and that HMAC. What does not: names, addresses, benefit status,
health conditions, household composition, or anything else in the local
database.

---

## What is real and what is not

| Component | Status |
| --- | --- |
| Meter readings | Simulated. Labelled as such in the interface. |
| Household need attributes | Synthetic, modelled on the fields a council already holds. |
| Council case notes | Synthetic free text. |
| Allocation engine | Real, deterministic, tested. |
| `SolacePound` token and settlement | Real transactions on a public testnet. |
| Money | None. `SolacePound` is a testnet demonstration token. |

`SolacePound` stands in for a regulated GBP stablecoin. It is a demonstration
token on a test network, holds no value, and is not a payment instrument.

---

## Out of scope

Deliberately not built: authentication, onboarding, fiat on- and off-ramps,
mobile layouts, settings and admin screens, multi-council tenancy, and real
smart meter integration. The universe is three solar households, eight recipient
households, and one council pot.

---

## Running it

Requires Node.js 20.9 or later.

```bash
npm install          # also generates the Prisma client
npm run db:migrate   # creates the local SQLite database
npm run dev
```

No configuration is needed to start. The application defaults to demo mode,
which runs entirely locally.

To configure keys and switch to live settlement on Base Sepolia:

```bash
cp .env.example .env.local
```

`.env.example` documents every value and why it exists.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dashboard |
| `npm run db:migrate` | Apply schema migrations |
| `npm run db:reset` | Drop and rebuild the database |
| `npm run db:studio` | Browse the database |
| `npm run db:seed` | Generate the whole demo universe |
| `npm run allocate` | Run the allocation engine and show its reasoning |
| `npm run settle` | Fund the pot and settle allocations on chain |
| `npm run demo:prepare` | Settle the history, hold back 12 for the live demo |
| `npm run ai:parse` | Parse council case notes into structured need signals |
| `npm run test` | Unit tests and contract tests |
| `npm run test:unit` | Unit tests only, no chain needed |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint |
| `npm run contracts:build` | Compile the Solidity |
| `npm run contracts:test` | Run the contract test suite |
| `npm run chain` | Start a local chain on port 8545 |
| `npm run deploy:local` | Deploy to the local chain |
| `npm run deploy:testnet` | Deploy to Base Sepolia |

Deploying records the contract address in the database, and the dashboard reads
it from there. No address is ever hardcoded, so the interface cannot end up
pointing at a contract that was replaced an hour before a demonstration.

Setting `SOLACE_SMOKE=1` alongside a deploy command follows the deployment with
a funded pot and one real settlement, which exercises the entire on-chain path
in a few seconds.

_(Seed and demo commands are added in later phases.)_

---

## Project layout

```
contracts/SolacePound.sol   The token and settlement contract
scripts/deploy.ts           Deployment, recorded to the database
scripts/seed.ts             Builds the demo universe
prisma/schema.prisma        Database schema, heavily commented
src/lib/synthetic/          The data generator
  rng.ts                      Seeded, reproducible randomness
  solar.ts                    Solar geometry and array output
  weather.ts                  Temperature and cloud
  meter.ts                    Half-hourly readings
  households.ts               The eleven households and the pot
src/lib/engine/             The allocation engine
  allocate.ts                 The solver
  scoring.ts                  The nine need factors and their weights
  fairness.ts                 The fairness decay
  digest.ts                   Canonical hashing, for replay
  load.ts                     Database to engine input
src/lib/domain.ts           Shared vocabulary and structured types
src/lib/config.ts           Runtime configuration and stated assumptions
src/lib/privacy.ts          The HMAC boundary; nothing else hashes
src/lib/ai/                The only two places a model is called
  parse-need-signals.ts      Case notes to structured scores
  generate-report.ts         Ledger figures to plain English
  report-facts.ts            The figures, gathered by ordinary code
src/lib/chain/             viem clients and the committed ABI
src/lib/settlement/        Allocations to on-chain transactions
src/lib/db.ts               Database client
src/lib/geo.ts              Distance between households
src/lib/format.ts           Money and energy formatting
test/contracts/             Contract tests, need Hardhat
test/unit/                  Unit tests, plain node
src/app/                    Dashboard
```

---

## Regulatory notes

_(to come in Phase 10)_

---

Built for the Parliamentary hackathon, September 2026.
