#!/usr/bin/env bash
#
# Solace — build the whole demonstration from nothing, offline.
#
#   npm run demo:setup
#
# Starts a local chain, deploys the token, generates thirty days of meter data,
# runs the allocation engine, settles the history on chain, and holds twelve
# allocations back to settle live on stage.
#
# Nothing here touches the internet. The chain is local, the database is a file,
# and the fonts were downloaded at build time. The only step that would use the
# network is case-note parsing, which is skipped without an API key and which
# the engine does not require.

set -euo pipefail

HOLD="${SOLACE_HOLD:-12}"
CHAIN_LOG="${TMPDIR:-/tmp}/solace-chain.log"
CHAIN_PID=""

cleanup() {
  if [ -n "$CHAIN_PID" ] && kill -0 "$CHAIN_PID" 2>/dev/null; then
    echo ""
    echo "  Stopping the local chain (pid $CHAIN_PID)."
    kill "$CHAIN_PID" 2>/dev/null || true
  fi
}

# Only clean up on failure. On success the chain must keep running — the
# dashboard needs it.
trap 'cleanup' ERR INT TERM

echo ""
echo "Solace — building the demonstration"
echo ""

# --------------------------------------------------------------------------
# 0. Check the deployer key is well formed
#
# A private key without its `0x` prefix is the single easiest mistake to make
# when copying one out of a wallet, and Hardhat's failure mode for it is
# especially unhelpful: the node process starts, never opens its port, and logs
# nothing. Catching it here turns twenty minutes of confusion into one line.
# --------------------------------------------------------------------------

if [ -f .env.local ]; then
  KEY_LINE=$(grep '^DEPLOYER_PRIVATE_KEY=' .env.local || true)
  KEY_VALUE="${KEY_LINE#DEPLOYER_PRIVATE_KEY=}"

  if [ -n "$KEY_VALUE" ]; then
    if ! printf '%s' "$KEY_VALUE" | grep -Eq '^0x[0-9a-fA-F]{64}$'; then
      echo "  DEPLOYER_PRIVATE_KEY in .env.local is not a valid private key."
      echo ""
      if printf '%s' "$KEY_VALUE" | grep -Eq '^[0-9a-fA-F]{64}$'; then
        echo "  It looks like the '0x' prefix is missing. It should read:"
        echo ""
        echo "      DEPLOYER_PRIVATE_KEY=0x<your 64 characters>"
      else
        echo "  Expected 0x followed by exactly 64 hexadecimal characters."
      fi
      echo ""
      echo "  Fix that line and run this again. (Leave it empty to use demo mode only.)"
      exit 1
    fi
  fi
fi

# --------------------------------------------------------------------------
# 1. A local chain
# --------------------------------------------------------------------------

if curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    --max-time 2 http://127.0.0.1:8545 >/dev/null 2>&1; then
  echo "  [1/6] A chain is already running on port 8545."
else
  echo "  [1/6] Starting a local chain (log: $CHAIN_LOG)"

  # Started directly rather than through `npm run`, so $! is the node itself.
  # Killing the npm wrapper leaves the node orphaned and holding the port.
  npx hardhat node >"$CHAIN_LOG" 2>&1 &
  CHAIN_PID=$!

  if ! curl -s --retry 60 --retry-delay 1 --retry-all-errors --max-time 90 \
      -X POST -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      http://127.0.0.1:8545 >/dev/null; then
    echo "        The chain did not start. Its log said:"
    echo ""
    sed 's/^/          /' "$CHAIN_LOG" | tail -20
    echo ""
    exit 1
  fi
  echo "        Chain ready (pid $CHAIN_PID)."
fi

# --------------------------------------------------------------------------
# 2-6. Everything else
# --------------------------------------------------------------------------

echo "  [2/6] Applying database migrations"
npx prisma migrate deploy >/dev/null

echo "  [3/6] Generating the demonstration universe"
npm run db:seed 2>&1 | grep -E "Households|Readings|Weather" | sed 's/^/        /'

echo "  [4/6] Deploying SolacePound"
npm run deploy:local 2>&1 | grep -E "Address" | sed 's/^/        /'

echo "  [5/6] Running the allocation engine"
npm run allocate 2>&1 | grep -E "Decisions|Replay|Delivered" | sed 's/^/        /'

echo "  [6/6] Settling the history, holding $HOLD back for the live beat"
npm run demo:prepare -- --hold "$HOLD" 2>&1 | grep -E "Remaining|Committed|Delivered|Awaiting" | sed 's/^/        /'

# Success: leave the chain running.
trap - ERR INT TERM

echo ""
echo "  Done. Start the dashboard with:"
echo ""
echo "      npm run dev"
echo ""
echo "  Then check everything with:"
echo ""
echo "      npm run doctor"
echo ""

if [ -n "$CHAIN_PID" ]; then
  echo "  The local chain is running as pid $CHAIN_PID. Stop it with:"
  echo ""
  echo "      kill $CHAIN_PID"
  echo ""
fi
