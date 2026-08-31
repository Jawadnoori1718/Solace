#!/usr/bin/env bash
#
# Solace — start everything, in one command.
#
#   npm run demo
#
# Brings up the local chain, makes sure the database and the contract are in
# place, resets the demonstration to its opening state, and starts the
# dashboard. Then it prints the address to open.
#
# This exists because juggling two terminals in front of an audience is a risk
# with no upside. On the day: one command, one window, one address.
#
# Press Ctrl-C once to stop everything cleanly.

set -euo pipefail

CHAIN_LOG="${TMPDIR:-/tmp}/solace-chain.log"
CHAIN_PID=""
STARTED_CHAIN=false

rpc() {
  curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    --max-time "${1:-2}" http://127.0.0.1:8545 >/dev/null 2>&1
}

cleanup() {
  echo ""
  echo "  Shutting down."
  if [ "$STARTED_CHAIN" = true ] && [ -n "$CHAIN_PID" ]; then
    kill "$CHAIN_PID" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup INT TERM

echo ""
echo "  Solace"
echo ""

# --------------------------------------------------------------------------
# The deployer key, if there is one, must be well formed
# --------------------------------------------------------------------------

if [ -f .env.local ]; then
  KEY_VALUE=$(grep '^DEPLOYER_PRIVATE_KEY=' .env.local | sed 's/^DEPLOYER_PRIVATE_KEY=//' || true)
  if [ -n "$KEY_VALUE" ] && ! printf '%s' "$KEY_VALUE" | grep -Eq '^0x[0-9a-fA-F]{64}$'; then
    echo "  DEPLOYER_PRIVATE_KEY in .env.local is not a valid private key."
    if printf '%s' "$KEY_VALUE" | grep -Eq '^[0-9a-fA-F]{64}$'; then
      echo "  It is missing its '0x' prefix."
    fi
    echo "  Fix that line and run this again."
    echo ""
    exit 1
  fi
fi

# --------------------------------------------------------------------------
# 1. The chain
# --------------------------------------------------------------------------

if rpc 2; then
  echo "  Chain      already running on port 8545"
else
  echo "  Chain      starting…"
  # Called directly rather than through npm, so the pid is the node itself.
  ./node_modules/.bin/hardhat node >"$CHAIN_LOG" 2>&1 &
  CHAIN_PID=$!
  STARTED_CHAIN=true

  if ! curl -s --retry 60 --retry-delay 1 --retry-all-errors --max-time 90 \
      -X POST -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      http://127.0.0.1:8545 >/dev/null; then
    echo "  Chain      failed to start. Its log said:"
    echo ""
    sed 's/^/    /' "$CHAIN_LOG" | tail -20
    exit 1
  fi
  echo "  Chain      ready"
fi

# --------------------------------------------------------------------------
# 2. Database, data, case notes and opening state
#
# Delegated to a TypeScript script so the checks can actually query the
# database. The shell version silently re-seeded every run, which wiped the
# parsed case notes each time.
# --------------------------------------------------------------------------

npx prisma migrate deploy >/dev/null 2>&1

# --------------------------------------------------------------------------
# 3. The contract
# --------------------------------------------------------------------------

echo "  Contract   deploying to the local chain…"
npm run deploy:local >/dev/null 2>&1
echo "  Contract   ready"

node scripts/demo-ensure.ts

echo ""
echo "  ────────────────────────────────────────────"
echo ""
echo "    Open   http://localhost:3000"
echo ""
echo "    Then work down the page:"
echo "      1  Deposit into the pot"
echo "      2  Point at the export panel"
echo "      3  Run the engine"
echo "      4  Settle now"
echo "      5  Generate report"
echo "      6  Open the block explorer"
echo ""
echo "    Press Ctrl-C to stop."
echo ""
echo "  ────────────────────────────────────────────"
echo ""

# --------------------------------------------------------------------------
# 5. The dashboard, in the foreground so Ctrl-C stops everything
# --------------------------------------------------------------------------

npm run dev
