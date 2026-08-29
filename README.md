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

A deterministic, reproducible solver. Given the same inputs it always produces
the same outputs, and every decision can be replayed and explained from those
inputs.

**No language model participates in deciding who receives energy.** _(detail to
come in Phase 4)_

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

_(Wiring allocations to settlement comes in Phase 5.)_

### Layer 4 — Councillor dashboard

A single page showing the pot balance draining in real time, a live feed of
allocations, the engine's reasoning for each one, a generated plain-English
report, and a link to the public block explorer for every settlement. _(to come
in Phases 6 and 7)_

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
src/lib/domain.ts           Shared vocabulary and structured types
src/lib/config.ts           Runtime configuration and stated assumptions
src/lib/privacy.ts          The HMAC boundary; nothing else hashes
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
