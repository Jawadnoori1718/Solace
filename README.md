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
households, plus thirty days of history.

**This data is simulated, and the interface says so wherever it appears.** We
have no smart meter access and do not imply otherwise. The integration path for
a real deployment is the Data Communications Company and supplier APIs.

### Layer 2 — Allocation

A deterministic, reproducible solver. Given the same inputs it always produces
the same outputs, and every decision can be replayed and explained from those
inputs.

**No language model participates in deciding who receives energy.** _(detail to
come in Phase 4)_

### Layer 3 — Settlement

`SolacePound` (`SLP`), an ERC-20 token deployed to the Base Sepolia public
testnet. Each allocation produces one on-chain transaction recording the energy
transferred, the timestamp, the pot it was drawn from, and a hashed recipient
identifier. _(detail to come in Phase 2 and Phase 5)_

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
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint |

_(Seed, test, contract deployment and demo commands are added in later phases.)_

---

## Project layout

```
prisma/schema.prisma   Database schema, heavily commented
src/lib/domain.ts      Shared vocabulary and structured types
src/lib/config.ts      Runtime configuration and stated assumptions
src/lib/db.ts          Database client
src/app/               Dashboard
```

---

## Regulatory notes

_(to come in Phase 10)_

---

Built for the Parliamentary hackathon, September 2026.
