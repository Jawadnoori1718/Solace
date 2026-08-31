# What building it taught us

Three things the data forced us to change. Each is recorded here because they
are the kind of thing a reviewer should not have to discover for themselves, and
because in each case the first design was wrong in a way that looked fine.

---

## 1. There is no solar surplus in a British winter

The premise, stated naively, is: route winter solar surplus to fuel-poor homes.

Running the simulation over two windows:

| Window | Surplus available | Worth at 28p | Recipient demand | Covered |
| --- | --- | --- | --- | --- |
| Late August | 944 kWh | £264 | 2,491 kWh | 37.9% |
| Mid January | **64.7 kWh** | **£18.12** | 4,656 kWh | **1.4%** |

That is not a bug in the model. It is British winter: the sun is low, the days
are short, and the exporting households use most of what little they generate.
Surplus is abundant exactly when need is lowest, and absent exactly when need
peaks.

**So the naive framing does not physically work.** Three rooftop arrays produce
roughly £265 of surplus a month at best, and essentially nothing in January.

**What does work is routing surplus whenever it exists and tracking the credit
until it is needed.** That turns the ledger from a nice-to-have into the
essential component: if value is banked in July and spent in January, something
has to hold an auditable record of whose surplus it was, who received it, and
what remains. That record is what Solace actually is.

It also sets the pot size. £400 across a month-long pilot is proportionate to
£264 of surplus; a £50,000 pot would sit almost untouched and the dashboard
would show a balance that never moved. A real Household Support Fund allocation
runs to millions across tens of thousands of homes — the thing that scales is
not the pot, but the property that every pound of it can be followed.

---

## 2. The fairness constraint was set too aggressively

The first implementation halved a household's priority after 40 kWh.

After a week of simulated allocations, that had pushed the **neediest** household
below the most comfortable one. The least needy home in the pilot — no benefits,
band C, one occupant, no health condition — was receiving more energy than a
household with a prepayment meter and a cold-sensitive illness.

Every individual decision was correct. The distribution was indefensible.

The half-life is now **150 kWh**, roughly five days of winter heating for a
poorly insulated home. The constraint is meant to stop one household absorbing
everything, not to equalise outcomes between households whose circumstances are
not equal.

---

## 3. Ranking was not enough — eligibility was missing

Raising the half-life barely changed the distribution, which was the useful
clue: **fairness was never the binding constraint.**

Surplus is scarce across a month but not within a sunny afternoon. At midday
three arrays produce *more* than the nearby households are drawing at that
moment, so ranking by need decided only the **order** households were served in,
not **whether** they were. Everyone in range was served, including the
comfortable household.

That is not a scarcity problem to be tuned away. It is a question about who a
fuel poverty fund is for — and every real fund answers it. The Household Support
Fund, the Warm Home Discount and ECO4 all have eligibility criteria.

Solace now has one: a need score below **0.35** is not eligible. It is a single
published constant a council can move, and the effect is a defensible
distribution:

```
Harrow Road      need 0.68  eligible      35% of its electricity covered
Vincent Square   need 0.60  eligible      31%
Queen's Park     need 0.55  eligible      26%
Church Street    need 0.51  eligible      22%
Westbourne       need 0.50  eligible      18%
Pimlico North    need 0.27  not eligible
Regent's Park    need 0.06  not eligible
West End         need 0.05  not eligible
```

Share of electricity covered now tracks need almost exactly. We report share
rather than raw kilowatt-hours deliberately: a five-person terrace absorbs far
more energy than a single pensioner, so absolute figures flatter large
households and understate what a delivery meant to a small one.

---

## 4. A constraint calibrated for the wrong city does nothing

The proximity radius began at eight kilometres, which was reasonable for a
Leeds-sized pilot. Westminster is about five kilometres corner to corner, so
eight covered the entire borough: every one of the twenty-four possible
exporter-to-household pairings was eligible and the constraint never once
changed an outcome. It looked like policy and did nothing.

At three kilometres, thirteen of the twenty-four pairings are eligible, every
recipient still has at least one roof within reach, and the northern and
southern halves of the borough are served by their own arrays. The number of
decisions fell from 293 to 261 — the difference is the constraint actually
binding.

A rule that never excludes anything is not a safeguard; it is decoration that
invites the question of what else on the page is decorative.

---

## 5. A bug that would have ruined the demonstration

Worth recording because the failure mode is so quiet.

After restarting the local chain, every settlement failed. The database still
recorded the pot as funded with £400 and a real transaction hash; the freshly
restarted chain had a zero balance. The contract's overdraw guard correctly
reverted all 280 transactions.

The failure followed an entirely ordinary action — restarting a terminal — and
reported "the contract function reverted", which points at nothing.

Two fixes:

- **The chain is now the authority on funding.** If it holds less than the
  database claims, the stale deposit is cleared and re-funded, with a plain
  explanation: *"The chain reports 0 pence in this pot but the database recorded
  40000. The chain was most likely restarted."*
- **Revert reasons are decoded.** Errors now walk viem's cause chain to name the
  actual custom error — `PotOverdrawn`, `NotASettler` — rather than reporting
  the generic symptom.

`npm run doctor` checks for exactly this before a demonstration starts.

---

## Things we would do next

- **Storage.** Every finding above points at the same gap. A battery, or a
  supplier-side credit mechanism, would let summer surplus reach winter need,
  and would make the ledger's role even clearer.
- **Anchoring rather than one transaction per allocation.** At pilot scale one
  transaction per allocation is fine. At council scale it is not; a Merkle root
  anchored periodically, with per-allocation proofs, would preserve
  verifiability at a fraction of the cost.
- **Real meter data.** Everything in Layer 1 is shaped like what the DCC
  actually returns, so this is an integration rather than a rewrite — but it is
  the largest single piece of unproven work here.
- **A security audit of the contract**, before it holds anything of value.
