# Running Solace

Requires Node.js 20.9 or later. Nothing else needs installing.

---

## The short version

```bash
npm install
npm run demo
```

Then open <http://localhost:3000>.

That single command starts a local chain, applies migrations, generates thirty
days of meter data for eleven households, deploys `SolacePound`, parses the
council case notes if an API key is configured, and resets the demonstration to
its opening state. It only does the work that is actually missing, so the second
run is near-instant.

The dashboard runs in the foreground. **Ctrl-C stops everything**, chain
included.

`npm run demo:setup` is the older variant that also pre-settles thirty days of
history and holds twelve allocations back. Use it if you would rather open on a
part-spent pot than perform beat one live.

---

## Before demonstrating anything

```bash
npm run doctor
```

Checks every dependency the demonstration relies on and prints the command that
fixes each problem. A typical healthy run:

```
[  ok  ] Database     11 households, 20,832 readings, 31 days of weather.
[  ok  ] Allocation   292 decisions, engine 1.0.0, digest a82c1cc4510d.
[  ok  ] Chain        Local Hardhat node is responding.
[  ok  ] Contract     SolacePound at 0x5FbDB231…
[  ok  ] Ledger       The database and the chain both report £298.01 remaining.
[  ok  ] Live beat    12 allocations are held back to settle on stage.
```

The **Ledger** check is the important one: it compares the balance computed from
the database against the balance read from contract storage. Everything `doctor`
checks has broken at least once during development.

---

## Demo mode and live mode

**Demo mode** (the default) settles on a local chain. Transactions are real —
really mined, really emitting events, really moving balances — they are simply
not public. **Nothing in this mode touches the internet**, which is the point: a
venue's wifi is not a dependency a demonstration should have.

**Live mode** settles on Base Sepolia, so the block explorer link points at a
transaction anybody in the room can verify from their own phone. It needs a
funded testnet key:

```bash
cp .env.example .env.local
# set DEPLOYER_PRIVATE_KEY, then:
SOLACE_MODE=LIVE npm run deploy:testnet
```

Use a throwaway wallet that has never held real funds.

---

## Configuration

Everything has a working default; a fresh checkout runs with no configuration at
all. `.env.example` documents every value and why it exists. The three worth
setting:

| Variable | Why |
| --- | --- |
| `SOLACE_HASH_SALT` | Makes on-chain recipient identifiers genuinely opaque. Generate with `openssl rand -hex 32`. |
| `ANTHROPIC_API_KEY` | Enables case-note parsing and report generation. The engine runs without it. |
| `DEPLOYER_PRIVATE_KEY` | A funded Base Sepolia key, for live mode only. |

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run demo` | **Start everything and open at the opening state** |
| `npm run demo:setup` | Build with thirty days pre-settled instead |
| `npm run doctor` | Check everything the demonstration needs |
| `npm run dev` | Start the dashboard |
| `npm run demo:prepare` | Re-settle the history, holding some back for the live beat |
| `npm run db:seed` | Regenerate the demo universe |
| `npm run db:migrate` | Apply schema migrations |
| `npm run db:reset` | Drop and rebuild the database |
| `npm run db:studio` | Browse the database |
| `npm run allocate` | Run the engine and print its reasoning |
| `npm run settle` | Fund the pot and settle allocations on chain |
| `npm run ai:parse` | Parse council case notes into structured need signals |
| `npm run chain` | Start a local chain on port 8545 |
| `npm run deploy:local` | Deploy to the local chain |
| `npm run deploy:testnet` | Deploy to Base Sepolia |
| `npm run test` | Unit tests and contract tests |
| `npm run test:unit` | Unit tests only, no chain needed |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint |
| `npm run contracts:build` | Compile the Solidity |
| `npm run contracts:abi` | Regenerate the committed ABI after a contract change |

Deploying records the contract address in the database and the dashboard reads
it from there, so the interface cannot end up pointing at a contract that was
replaced an hour before a demonstration.

`SOLACE_SMOKE=1` alongside a deploy command follows the deployment with a funded
pot and one real settlement, exercising the whole on-chain path in seconds.

---

## When things go wrong

**The dashboard degrades rather than breaking.** With the chain stopped it still
renders every figure, states that they come from the local ledger, and says
settlement is paused until the chain returns. The settlement stream returns a
readable error rather than hanging. No stack trace reaches the screen.

### "There is no contract at 0x… The chain was restarted"

The local chain was stopped and started again. It keeps no state between runs,
so the contract is gone even though the database still records where it was.

```bash
npm run deploy:local
```

Deposits and settlements are refused until you do, deliberately: a contract call
to an address with no code does not fail, it silently does nothing and returns a
transaction hash. Reporting that as a confirmed deposit would be worse than any
error message.

### "The chain reports 0 pence but the database recorded 40000"

The local chain was restarted. It keeps no state between runs; the database
does. Run `npm run demo:prepare` — it clears the stale deposit, re-funds, and
re-settles.

### Settlements failing with `PotOverdrawn`

The same cause as above. The contract is correctly refusing to spend money the
pot does not have.

### "Nothing pending" and the live beat is empty

Everything is already settled, so there is nothing to demonstrate. Run
`npm run demo:prepare` to hold twelve back again.

### The report says no API key is configured

Expected without `ANTHROPIC_API_KEY`. The dashboard still shows the computed
figures and falls back to the most recent stored report, labelled as stale. The
allocation engine is unaffected — it never calls a model.

---

## Re-running the AI parsing

```bash
npm run ai:parse       # parses unparsed case notes
npm run allocate       # need scores have changed, so re-run the engine
```

Parsing writes a score into the database; the engine reads that column. They are
two separate, auditable acts, which is what keeps the determinism claim honest.
Re-running the parser without re-running the engine changes nothing.

---

## Regenerating after a contract change

```bash
npm run contracts:build
npm run contracts:abi     # the committed ABI must not drift
npm run test
```

A test fails if the committed ABI and the compiled contract disagree.
