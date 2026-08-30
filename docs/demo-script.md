# The demonstration

Six beats, about four minutes. Written to be read beforehand, not from.

---

**Everything below is performed in the browser.** There is a step bar across
the top of the page showing the six beats and which one is next, and a
**Start over** button that clears deposits, allocations and settlements so the
whole thing can be run again. Rehearse it twice.

---

## Setup, fifteen minutes before

```bash
npm run demo:setup
npm run dev
npm run doctor          # in a second terminal
```

Everything should read `ok` except, possibly, the Anthropic key and the hash
salt — both degrade gracefully and neither stops the demonstration.

**Open a second browser tab on the block explorer already**, loaded and logged
in to nothing. Beat six is the only step that needs the internet, and a page
that is already open cannot fail to load.

If anything reads `BLOCKED`, `doctor` prints the command that fixes it.

---

## Beat 1 — A council deposits into a winter pot

*"Leeds City Council is committing four hundred pounds from its Household
Support Fund to a winter pot. Watch."*

In **Commit council money**, type an amount — or take one from the room — and
press **Deposit into the pot**. The button says "Confirming on chain…" while it
waits for a real receipt, then returns the transaction hash.

The headline figure above updates. That is beat one, done live, with a figure
somebody in the room chose.

---

## Beat 2 — Three solar households are exporting right now

*"Three households in Adel, Horsforth and Roundhay have rooftop solar. Right now
they are exporting surplus to the grid for about fifteen pence a unit."*

Point at **Worth on the grid**. That is what the delivered energy would have
earned had it been sold to the grid instead — the gap Solace closes, as a
number.

Then scroll to **Where the energy went**. This is the picture worth pausing on:
three roofs on the left, eight homes on the right, and the thickness of every
line is the energy that actually moved. If somebody in the room takes one image
away, make it this one.

Say plainly that the meter data is simulated. It is labelled at the foot of the
page. Saying it before anyone asks is worth more than the data being real.

---

## Beat 3 — The engine decides, and shows its reasoning

*"Eight households nearby need help. The engine decides which of them receives
that surplus — and it will tell you exactly why."*

Press **Run the engine**.

It shows its working in three steps: every household assessed with its need
score and whether it cleared the threshold; the window solved, with the digests;
and then a replay proving the same input produces byte-identical output. Let the
assessments finish appearing before you talk over them.

Then scroll to **Recent allocations** and open the first row.

Walk through one factor, not all nine: *"This household is in a band G property.
That factor carries a published weight of 0.14, and it contributed 0.14 to a
need score of 0.73."*

Then the sentence that answers the question a civil servant is about to ask:

> *"No language model was involved in this decision. The engine is a pure
> function — same input, same output, every time. There is a test that reads the
> engine's source and fails if anybody ever wires a model into it."*

Scroll to **Households that received nothing**. *"And it explains its refusals,
not just its choices. This household scored 0.06 — below the threshold this fund
publishes."*

---

## Beat 4 — Settlement fires, and the pot drains

*"Twelve allocations are waiting to settle. Watch the balance."*

Press **Settle now**.

Rows appear one at a time as each transaction is mined, and the remaining
balance counts down. Let it run — say nothing for a few seconds.

> *"Each of those rows appeared only after its transaction was mined and its
> receipt confirmed. Nothing on this screen is anticipating the chain."*

---

## Beat 5 — One click, a report for a scrutiny committee

*"A councillor has to account for this money. So:"*

Press **Generate report** in the right-hand column.

Read one sentence aloud. Then point at the line beneath it:

> *"Every figure in this report was checked against the ledger it was generated
> from. None was introduced by the model."*

*"The model wrote the sentences. It did not source the facts — those were
computed from the ledger before it was called, and every number in the prose was
checked back against them afterwards."*

Open **The figures this report was written from** if anyone looks sceptical.

---

## Beat 6 — Verify it yourself

*"Everything I have shown you so far is this application's own account of
itself. So don't take it."*

Click **Verify the most recent settlement on the public block explorer**.

The explorer shows the transaction, the token movement, and the decoded
`AllocationSettled` event: the energy in milli-kWh, the amount, the pot
reference, the timestamp.

> *"That is on a public testnet. Anybody in this room can open it on their phone
> right now. And notice what is not there — no name, no address, no benefit
> status. The recipient is a keyed hash. The council can reverse it; nobody else
> can."*

**In demo mode there is no public explorer**, because the chain is local. The
dashboard says so rather than pretending. To get a public link, deploy to Base
Sepolia in advance and run the demonstration in live mode, or show one real
Base Sepolia transaction captured earlier.

---

## Questions you should expect

**"Is this blockchain for the sake of blockchain?"**
The requirement is that a councillor can prove where money went to someone who
does not trust the council. That needs a record the council cannot quietly
edit. A database with an audit log is a record the operator can rewrite; a
public chain is not.

**"What about GDPR? It's immutable."**
No personal data goes on chain, so there is nothing to erase there. An erasure
request is satisfied by deleting the local mapping and destroying the salt,
after which the on-chain record is permanently unlinkable to any person — by
anyone, including the council. [docs/privacy.md](privacy.md).

**"How do you know the AI isn't deciding who's poor?"**
Because it cannot reach the engine. It reads case notes into a database column,
once, and the engine reads a number. There is a test asserting the engine
imports nothing from the AI layer.

**"Does solar actually work for this in winter?"**
No, and we say so. Three arrays produce 37.7 kWh in a January window against
4,886 kWh of demand. Which is exactly why the ledger matters — surplus has to be
banked when it exists and spent when it is needed.
[docs/findings.md](findings.md).

**"What would it cost at scale?"**
One transaction per allocation is right at pilot scale and wrong at council
scale. The next step is anchoring a Merkle root periodically with
per-allocation proofs, which preserves verifiability at a fraction of the cost.

**"Has this been audited?"**
No. The contract is short and uses OpenZeppelin's ERC-20, but it has had no
security audit and should not hold value until it has.
