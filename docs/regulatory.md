# Regulatory notes

Written so that a civil servant reading this repository can see what we are and
are not claiming. **Nothing here is legal advice**, none of it has been reviewed
by a regulator, and a live deployment would need proper counsel.

---

## What `SolacePound` is

A **testnet demonstration token**. It holds no value, is not money, is not
redeemable for anything, and is not a payment instrument. It exists on a public
test network where the underlying ether is itself valueless and freely given
away by faucets.

It is minted by the demonstration contract because there is no issuer behind it.
**In production it would not be.** The council would transfer existing regulated
stablecoin from its own balance, and the `fundPot` function would move tokens
rather than create them. The accounting that follows — and the overdraw
protection — is identical either way.

## What it stands in for

A **regulated GBP stablecoin**: a fully-backed e-money token issued by an
authorised institution. In the UK that means an issuer authorised by the FCA
under the e-money regime, with the backing assets safeguarded and redeemable at
par on demand.

The relevant frameworks, as they stand:

- **HM Treasury and the FCA** have consulted on a regime for fiat-backed
  stablecoins used for payments, with the Bank of England taking systemic
  payment systems.
- **The Electronic Money Regulations 2011** already govern e-money issuance and
  safeguarding, and are the most likely near-term home for a GBP stablecoin used
  this way.
- **The Payment Services Regulations 2017** would govern the movement of funds
  between the council, the issuer and any redemption agent.

Solace does not attempt to be an issuer, and does not need to be. It is a
settlement and accountability layer that would sit **on top of** a compliant
token, in the same way it currently sits on top of a demonstration one.

---

## What Solace would and would not be regulated as

**Not a payment institution.** Solace does not hold client money, does not
execute payment transactions on behalf of others, and does not come into
possession of funds. The council holds the tokens; Solace records where they go.

**Not an energy supplier.** Solace does not sell electricity, hold a supply
licence, or take title to energy. It records that a quantity of surplus was
directed to a household and that the council paid for it. Actual delivery of
electrons is the grid's; the commercial arrangement between the council, the
supplier and the household is out of scope and would need to be structured with
Ofgem's rules in mind.

**Not a benefits administrator.** The council decides who is eligible and
publishes the criteria. Solace applies those criteria deterministically and
shows its working. The decision remains the council's, and the appeal route
remains the council's.

The most likely regulatory question in practice is **not** about the token. It
is about **automated decision-making** — see below.

---

## Automated decision-making

Allocation is automated, it affects individuals, and that engages the relevant
provisions of UK GDPR on automated decisions.

Three properties of the design are directly responsive:

1. **It is explicable.** Every decision carries each factor, its published
   weight and its contribution. A household can be told precisely why it was or
   was not selected, in terms a person can check.
2. **It is reproducible.** The same input always produces the same decision, and
   the digests prove which input produced which output. A challenge can be
   examined rather than re-litigated from memory.
3. **The criteria are a published policy, not a learned model.** There are no
   weights fitted to historic data, so there is no mechanism by which past
   inequity becomes future policy without anyone noticing. Changing the
   behaviour means changing a published number in a committee.

**A human remains in the loop by design.** The council sets the weights and the
eligibility threshold, and can override any allocation. Solace is a
recommendation and settlement system, not a decision-maker of last resort.

We would expect a deployment to require a DPIA, a published statement of the
weights, and a stated route for a household to contest a decision.

---

## Public money and audit

The properties a section 151 officer would care about:

- **Spending cannot exceed the pot.** Enforced by the contract, not the
  application, so it holds even if the application is wrong.
- **Every movement is individually attributable** to a decision, a date, a
  quantity of energy and a reason.
- **The ledger is independently verifiable.** The pot balance is computed both
  from the database and from contract storage, and the two are compared. An
  auditor does not have to trust the application's own account of itself.
- **Historic decisions remain explicable under the rules in force at the time**,
  because the engine version is recorded against every run.

---

## Honest limits

- **This is a pilot-scale demonstration.** Eleven households, one pot, one month.
  Nothing here has been load-tested, penetration-tested, or audited.
- **The contract has not had a security audit.** It is short and uses
  OpenZeppelin's ERC-20, but it has not been reviewed by anyone qualified to
  sign off on it, and it should not hold value until it has.
- **The energy arrangement is modelled, not contracted.** A real scheme needs
  agreements with a licensed supplier and a settlement route acceptable to
  Elexon and Ofgem. That work is not started.
- **No regulator has seen this.** Nothing in this document should be read as
  suggesting otherwise.
