# Solace

**An accountability layer for fuel poverty spending.**

---

## The problem

UK councils distribute fuel poverty support — Household Support Fund grants,
ECO4 measures, Warm Home Discount top-ups — as vouchers and BACS payments. Once
the money leaves the council, it becomes very difficult to say where it landed
or what it bought. A councillor who signs off half a million pounds of winter
support cannot easily tell a scrutiny committee which households were warmer as
a result.

At the same time, a household with rooftop solar exports its surplus to the grid
for a few pence per unit, while a family three streets away sits in the cold.

Solace routes that surplus to households in need, settles it in a
GBP-denominated token, and writes every movement to a public ledger. A
councillor deposits into a winter pot and sees, in real time and in plain
English, exactly which kilowatt-hours reached which household — and can hand
anyone in the room a link to verify it independently.

**This is not an energy trading product. It is public-sector accountability
infrastructure that happens to move electricity.**

---

## The four layers

| Layer | What it does | Status |
| --- | --- | --- |
| **1 · Signal** | Half-hourly meter data for eleven households over thirty days | Simulated, labelled as such |
| **2 · Allocation** | A deterministic solver that decides who receives energy | Real, tested, reproducible |
| **3 · Settlement** | An ERC-20 token and one transaction per allocation | Real transactions on a public testnet |
| **4 · Dashboard** | What a councillor sees, and can print for a committee | Real |

The separation between layers 2 and 4 is the one that matters, and it is set out
in **[docs/architecture.md](docs/architecture.md)**.

---

## Why the allocation is deterministic, and why no AI touches it

The engine is a **pure function**: no database, no network, no clock, no
language model, and no random number that is not derived from the run's
published seed. Given the same input it produces byte-identical output, and
every run stores a SHA-256 digest of its canonicalised input and output so
anyone can re-run it and check.

Nine weighted factors produce a need score. The weights are published, they are
a policy position rather than a technical one, and every decision carries its
own arithmetic — each factor, its value, its weight and its contribution — so a
reader can add up the column themselves. Households that received nothing get a
stated reason too.

That matters because the disagreement then moves from *"why did the computer
choose them"* to *"is a health condition worth more than an EPC band"* — which
is a policy question, and one a councillor is entitled to answer.

**The Anthropic API does exactly two jobs, and neither is allocation.** It turns
free-text council case notes into structured need scores, once, which are then
persisted; and it turns ledger figures computed by ordinary code into the plain
English of the report. It interprets inputs and describes outcomes. It never
decides who gets what.

**The separation is tested, not promised.** A test reads every file under
`src/lib/engine/` and fails if any of them imports the AI layer or the Anthropic
SDK, constructs a client, calls `fetch`, reads the clock, or uses `Math.random`.

---

## Privacy

**No personal data is ever written on chain, and none can be.**

Recipients appear on chain only as an HMAC-SHA256 of an internal household
reference, keyed with a secret salt that lives in `.env.local` and is never
committed. The mapping back to a household exists only in the council's own
database.

The salt is not decoration. A pilot covers a small, enumerable set of
households, so an *unsalted* hash of a household reference could be brute-forced
in seconds and the privacy claim would be false. A keyed HMAC defeats that
attack, because without the salt an attacker cannot compute the hash of a
candidate reference at all.

What reaches the chain: a quantity of energy, an amount, a timestamp, a pot
reference, and that HMAC. What does not: names, addresses, benefit status,
health conditions, household composition, or case notes. A test builds the exact
arguments sent to the contract and searches them for every piece of personal
data the system holds.

Full threat model: **[docs/privacy.md](docs/privacy.md)**.

---

## What is real, what is simulated, what is not built

| Component | Status |
| --- | --- |
| Meter readings | **Simulated.** No smart meter access. Integration path is DCC and supplier APIs. |
| Household attributes and case notes | **Synthetic.** Modelled on fields a council already holds. No real person is described. |
| Allocation engine | **Real.** Deterministic and tested. |
| `SolacePound` and settlement | **Real transactions** on a public testnet. |
| Money | **None.** |

**`SolacePound` is a testnet demonstration token standing in for a regulated GBP
stablecoin.** It holds no value, is not money, and is not a payment instrument.
In a production deployment the token would be issued by a regulated e-money
institution, not by this contract. See
**[docs/regulatory.md](docs/regulatory.md)**.

**Deliberately not built:** authentication, onboarding, fiat on- and off-ramps,
mobile layouts, settings and admin screens, multi-council tenancy, and real
smart meter integration. The universe is three solar households, eight recipient
households, and one council pot.

---

## Running it

Requires Node.js 20.9 or later.

```bash
npm install
npm run demo
```

Then open <http://localhost:3000>.

One command does everything: starts a local chain, generates thirty days of
meter data, deploys the token, parses the council case notes, and resets the
demonstration to its opening state. It only does the work that is actually
missing, so the second run is near-instant. Ctrl-C stops it all.

**All six beats are then performed in the browser** — commit council money,
watch the roofs export, run the engine, settle, generate the report, open the
explorer. A step bar shows which beat is next, and **Start over** returns
everything to the beginning so it can be rehearsed as often as you like.

**Nothing in demo mode touches the internet.** Run `npm run doctor` beforehand;
it checks every dependency and prints the command that fixes each problem.

Full command reference and the failure modes: **[docs/running.md](docs/running.md)**.
The six beats of the demonstration, and the questions to expect:
**[docs/demo-script.md](docs/demo-script.md)**.

---

## What building it taught us

The simulation surfaced something worth stating plainly: **in a British winter,
rooftop solar produces almost nothing.** Across a January window, three arrays
generate 37.7 kWh against 4,886 kWh of household demand. So the naive framing —
route winter solar surplus to fuel-poor homes in winter — does not physically
work.

What does work is routing surplus whenever it exists and tracking the credit
until it is needed. That makes the ledger the essential component rather than a
nice-to-have. Details, and the two other findings that changed the engine:
**[docs/findings.md](docs/findings.md)**.

---

Built for the Parliamentary hackathon, September 2026.
