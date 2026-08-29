# Architecture

Four layers. The separation between the second and the fourth is the one that
matters: the engine decides, and everything else reports what it decided.

---

## Layer 1 — Signal

Half-hourly meter data for three exporting households and eight recipient
households, across thirty days.

**This data is simulated, and the interface says so wherever it appears.** We
have no smart meter access and do not imply otherwise. The integration path for
a real deployment is the Data Communications Company and supplier APIs, which
expose exactly this shape: half-hourly consumption and export per meter point.

It is simulated carefully rather than sketched. Generation comes from real solar
geometry — declination, hour angle, air mass, the equation of time — so day
length and the shape of the morning ramp are correct for the latitude and the
date. Weather is autocorrelated, so cloudy spells persist rather than flicker
every thirty minutes. Consumption is a base load that scales with occupancy plus
a heating load driven by the actual temperature, calibrated per household.

Most importantly, **fuel poverty is present in the readings rather than asserted
alongside them.** A household that cannot afford heat consumes less than the
weather says it should, and a prepayment meter that runs out goes dark for
hours. Both appear in the generated data, and the engine detects them from the
readings alone. In the seeded month the four prepayment households show
sustained multi-hour spells below a quarter of their own median evening
consumption; the credit-meter households show none.

**Why electrically heated households.** Most British homes heat with gas, and
Solace moves electricity. The households modelled here heat with electricity,
which is not an evasion of that problem but the point of it: electric heating
costs several times what gas does per unit of heat, it concentrates in flats,
older terraces and homes off the gas grid, and it correlates strongly with
prepayment metering. Those are the households a winter fund is trying to reach.

Every value derives from a single seed string. Running the seed twice produces
byte-identical data, which is what makes the engine's reproducibility claim
checkable rather than merely stated.

---

## Layer 2 — Allocation

A deterministic, reproducible solver. Given the same input it produces
byte-identical output, and every decision can be replayed and explained from
that input alone.

**No language model participates.** The engine is a pure function: no database,
no network, no clock, no model, and no random number not derived from the run's
published seed.

### How a household is scored

Nine factors, each normalised to 0–1, each multiplied by a fixed published
weight, and summed. The weights are a policy position and are stated as such — a
council adopting Solace would set them through the same committee that signs off
its fuel poverty strategy.

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
parsed — it is dropped and the remaining weights are scaled back up. **A
household is never penalised for a gap in the council's records**, because a
missing record is not evidence of comfort.

### Measuring what the meter cannot say directly

*Consumption shortfall* is the factor that distinguishes a cold home from a
frugal one. "Used 9 kWh yesterday" means nothing on its own; "used 38% less than
this weather requires" is the whole signal.

Expected consumption interpolates between the household's own measured base load
— taken from the mildest quarter of the window, when almost nothing is spent on
heat — and the cold-weather baseline the council holds from EPC modelling of the
building. Deriving the base load from the household's own data matters: a
household that rations cuts its heating, not its fridge, so the estimate stays
accurate exactly when it needs to be.

*Self-disconnection* looks only at the evening peak. A near-zero half-hour at
four in the morning is a household asleep; a near-zero half-hour at seven in the
evening, sustained for two hours, is a household that cannot cook. The threshold
is a quarter of that household's own median evening consumption, so a
single-occupant flat is judged against itself rather than against a family of
five.

### Three constraints bind the solver

**Proximity.** A recipient must be within 8 km of the exporting household.
Surplus delivered locally puts less strain on the distribution network, and a
councillor can defend a neighbourhood-level match in a way they cannot defend a
national one.

**Concurrent demand.** A household is only matched against surplus it could
actually have used at that moment. Energy generated at two in the afternoon
cannot warm a house at eight in the evening without storage, and this pilot has
none. This makes the numbers smaller and the claim true.

**Fairness.** Priority decays with what a household has already received:

```
priority = need ÷ (1 + servedKwh / 150)
```

Without it, the neediest household is neediest again tomorrow and every day
after. A need-weighted allocator would hand everything to one home while every
individual decision remained defensible.

### Eligibility

A need score below **0.35** is not eligible. The threshold exists because the
data demanded it — see [findings.md](findings.md) — and it is a single published
constant a council can move.

### Reproducibility is attested, not asserted

Every run stores a SHA-256 digest of its canonicalised input and output. Re-run
the engine on the same input and both digests must match. The test suite holds
it to that, including against inputs built in a different key order and with
households listed in a different sequence — and separately checks that the
digest *does* change when circumstances change, because a digest insensitive to
its input proves nothing.

---

## Layer 3 — Settlement

`SolacePound` (`SLP`) is an ERC-20 token deployed to the Base Sepolia public
testnet.

**It is denominated in pounds, not the customary 18 decimals.** `decimals` is 2,
so one SLP is one pound and the smallest unit is one penny. Every amount starts
life as an integer number of pence in the council's ledger, so a two-decimal
token maps to it exactly, with no scaling and no rounding. A block explorer
shows `400.00 SLP` against a pot funded with £400.00, and the two figures are
the same figure.

**Each allocation calls `settle()`, not `transfer()`.** A bare ERC-20 transfer
can only say that an amount moved between two addresses. `settle()` emits an
`AllocationSettled` event carrying the energy in milli-kWh, the amount, the pot
reference, the timestamp and the hashed recipient — so the public record states
what the money bought, not merely that it moved. It also emits a standard
`Transfer`, so ordinary tooling sees it too.

**A pot cannot be overdrawn**, and the chain enforces it rather than the
application. The rule holds even if our own code has a bug.

**Recipient marker addresses.** Tokens are sent to an address derived
deterministically from the recipient hash. To be explicit: nobody holds the key
to that address, so this records that credit belongs to a household rather than
transferring into a household's wallet. A production deployment would credit
either a household-controlled wallet or a regulated custodian who redeems the
balance against the household's energy account. The audit trail is identical;
only the redemption step differs, and that is out of scope here.

**The local record is written before the transaction is sent**, so a transaction
that succeeds on chain while the process dies still leaves evidence behind. A
settlement with no local record would be money that moved with nothing to
explain it — the exact failure Solace exists to prevent.

**Settlement never throws.** A failure is recorded with its reason and the run
continues. A settlement run that stops dead on the first bad transaction is
useless on a stage.

**The ledger is checked against the chain.** The pot balance is computed twice
by entirely different means — by summing database rows and by reading contract
storage — and the two are compared. The dashboard says when they agree, and says
so much louder when they do not.

---

## Layer 4 — Councillor dashboard

A single page, civic in tone. It is meant to look like something a councillor
could print and take to a scrutiny committee, not like a financial product.

The headline is what remains in the pot, because that is the question being
asked. Around it: energy delivered, households reached out of households
assessed, settlements confirmed on chain, and what the same kilowatt-hours would
have earned exported to the grid instead — the gap Solace closes, as a number.

**Households are ordered by the share of their electricity Solace covered, not
by raw kilowatt-hours.** A five-person terrace absorbs far more energy than a
single pensioner in a flat, so absolute figures flatter large households and
understate what a delivery meant to a small one. Households that received
nothing appear too, with the engine's reason.

**Every allocation opens to show its reasoning** — each factor, its raw value,
its published weight, and what it contributed, so a reader can check the
arithmetic rather than take the total on trust.

**Settlement runs live.** Pressing "Settle now" opens a server-sent event stream
that settles pending allocations one at a time while the balance counts down.
Each row appears only after its transaction has been mined and its receipt
confirmed — the feed reports the chain, it does not anticipate it. The only
artifice is a pause between settlements so a person can follow them; on a local
chain they otherwise complete in about four milliseconds each.

**Three provenance notes sit at the foot of every page** — what the meter data
is, what reaches the chain, and what `SolacePound` is. A system handling public
money should say what it knows and what it does not, and that has to be on the
page rather than buried in a repository.

The palette was validated rather than chosen by eye: worst adjacent contrast
under simulated colour-vision deficiency is ΔE 22.1 against a floor of 8, and
ΔE 28.1 for normal vision against a floor of 15.

---

## Project layout

```
contracts/SolacePound.sol     The token and settlement contract
prisma/schema.prisma          Database schema, heavily commented

src/lib/synthetic/            The data generator
  rng.ts                        Seeded, reproducible randomness
  solar.ts                      Solar geometry and array output
  weather.ts                    Temperature and cloud
  meter.ts                      Half-hourly readings
  households.ts                 The eleven households and the pot

src/lib/engine/               The allocation engine
  allocate.ts                   The solver
  scoring.ts                    The nine factors and their weights
  fairness.ts                   The fairness decay
  digest.ts                     Canonical hashing, for replay
  load.ts                       Database to engine input

src/lib/ai/                   The only two places a model is called
  parse-need-signals.ts         Case notes to structured scores
  generate-report.ts            Ledger figures to plain English
  report-facts.ts               The figures, gathered by ordinary code

src/lib/privacy.ts            The HMAC boundary; nothing else hashes
src/lib/chain/                viem clients and the committed ABI
src/lib/settlement/           Allocations to on-chain transactions
src/lib/config.ts             Runtime configuration and stated assumptions

test/unit/                    Unit tests, plain node, no chain needed
test/contracts/               Contract tests, need Hardhat
src/app/                      Dashboard
```

---

## Stated assumptions

These are assumptions, not cited statistics, and they are configurable in
`.env.local` so a reviewer can substitute their own and see what changes.

| Assumption | Value | Where |
| --- | --- | --- |
| Tariff used to price delivered energy | 28p per kWh | `SOLACE_TARIFF_PENCE_PER_KWH` |
| Rate a household earns exporting to the grid | 15p per kWh | `SOLACE_EXPORT_PENCE_PER_KWH` |
| Proximity radius | 8 km | `SOLACE_PROXIMITY_RADIUS_KM` |
| Fairness half-life | 150 kWh | `src/lib/engine/fairness.ts` |
| Eligibility threshold | 0.35 | `src/lib/engine/allocate.ts` |
| Factor weights | see table above | `src/lib/engine/scoring.ts` |
