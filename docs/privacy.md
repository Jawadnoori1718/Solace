# Privacy

**No personal data is ever written on chain, and none can be.**

---

## What reaches the chain

Exactly four things are passed to the settlement contract:

| Field | What it is |
| --- | --- |
| `potReference` | A hash of a public pot identifier, e.g. `WINTER-2026` |
| `recipientHash` | An HMAC-SHA256 of an internal household reference |
| `milliKwh` | An integer quantity of energy |
| `amountPence` | An integer amount of money |

The contract also records a block timestamp and a sequence number.

## What does not

Names, addresses, postcodes, benefit status, EPC bands, health conditions,
household composition, meter type, case notes, or anything else the local
database holds. Not because we filter them out — because they are never passed
to a contract call. `src/lib/settlement/service.ts` is the only code that talks
to the contract, and it constructs those four arguments and nothing else.

A test builds the exact arguments `settle()` receives and searches them for
every piece of personal data in the system, including full case-note text.

---

## The threat model

The naive design would be a plain SHA-256 of a household reference. That would
be **reversible in practice**, and the privacy claim would be false.

A council pilot covers a small, enumerable set of households. An attacker who
suspects the references look like `REC-01`, `REC-02`, and so on can compute the
hash of every candidate up to a few thousand and match them against the chain in
well under a second. Hashing alone protects nothing when the input space is
small and guessable, which is exactly the situation here.

**A keyed HMAC under a secret salt breaks that attack.** Without the salt, an
attacker cannot compute the hash of a candidate reference at all, so the
enumeration has nothing to compare against. The salt is generated per
deployment, lives in `.env.local`, is git-ignored, and never leaves the server.

The test suite proves both halves of this: that a guessed reference under the
wrong salt does not match, and that the correct reference under the correct salt
does — so the test is detecting the salt rather than a broken hash function.

### What an observer of the chain can learn

- That a pot delivered a certain quantity of energy on a certain date.
- That the same opaque identifier received energy several times.
- The total delivered to that identifier.

### What they cannot learn

- Which household any identifier refers to.
- Where it is, who lives there, or why it qualified.
- Whether two identifiers are neighbours.

Re-identification requires the salt, which only the council holds.

---

## Why the pot reference is *not* salted

`potReference` is hashed with a fixed, non-secret key. That is deliberate: a
councillor should be able to quote "WINTER-2026" in a committee, and members of
the public should be able to find that pot's transactions. Pot identifiers are
public by design. They are hashed only because `bytes32` is fixed-width and
cheaper on chain than a string.

---

## Marker addresses

Settlement sends tokens to an address derived from the recipient hash by
truncation — the same way Ethereum derives addresses generally.

Two consequences worth stating plainly:

1. **Nobody holds the private key.** The address is unspendable. It records that
   credit belongs to a particular household; it is not a transfer into a
   household's own wallet.
2. **The address is derived from the hash, so it leaks exactly as much as the
   hash does** — which, under a secret salt, is nothing.

A production deployment would credit either a household-controlled wallet or a
regulated custodian redeeming the balance against the household's energy
account. The audit trail is identical either way.

---

## Data protection

For a real deployment, the framing under UK GDPR would be:

- **On-chain data is pseudonymised, not anonymised.** The council can re-identify
  a household using the salt it holds, so the on-chain record remains personal
  data *for the council*, and the council remains the controller. It is not
  personal data for anybody without the salt.
- **The chain is immutable, and erasure is a right.** This is the genuine
  tension. Solace's answer is that no personal data goes on chain in the first
  place, so a subject-erasure request is satisfied by deleting the local mapping
  and destroying the salt — after which the on-chain record is permanently
  unlinkable to any person, by anyone, including the council.
- **Data minimisation.** The engine reads only the fields a council already
  holds for fuel poverty purposes. Solace requires no new collection.
- **A DPIA would be required** before any live deployment, and the salt handling
  and key custody would be the substantive part of it.

None of this has been reviewed by a data protection officer, and it should be
before anything touches a real household.

---

## What we have not solved

- **Salt custody.** A salt in an environment file is right for a pilot and wrong
  for production, which needs an HSM or a managed secret store with rotation.
  Rotating the salt breaks the link to historic on-chain records, which is a
  design question, not a bug.
- **Traffic analysis.** An observer who knows when a specific household's meter
  reports could correlate timing against settlements. Batching would mitigate
  this and is not implemented.
- **The council is still trusted.** Solace makes spending verifiable by anybody;
  it does not remove the council's ability to see its own residents' data. That
  is appropriate — the council is the controller and has a statutory basis — but
  it is a limit on what "privacy-preserving" means here, and worth being precise
  about.
