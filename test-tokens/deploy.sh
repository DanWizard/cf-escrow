#!/usr/bin/env bash
# deploy.sh — build and deploy test-tokens to devnet
#
# Usage:
#   ./deploy.sh              # devnet (default)
#   ./deploy.sh localnet     # local test validator

set -euo pipefail

NETWORK="${1:-devnet}"
KEYPAIR_PATH="${KEYPAIR_PATH:-$HOME/.config/solana/id.json}"
PROGRAM_SO="target/deploy/test_tokens_program.so"
PROGRAM_KEYPAIR="target/deploy/test_tokens_program-keypair.json"
API_LIB="api/src/lib.rs"

case "$NETWORK" in
  devnet)   RPC_URL="https://api.devnet.solana.com" ;;
  localnet) RPC_URL="http://127.0.0.1:8899" ;;
  *)
    echo "ERROR: Unknown network '$NETWORK'. Use devnet or localnet."
    exit 1 ;;
esac

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

step() { echo -e "\n${BOLD}==> $1${RESET}"; }
ok()   { echo -e "    ${GREEN}✓${RESET} $1"; }
warn() { echo -e "    ${YELLOW}⚠${RESET}  $1"; }
err()  { echo -e "    ${RED}✗${RESET} $1"; }

step "Checking Solana CLI..."
if ! command -v solana &>/dev/null; then
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
ok "$(solana --version)"

step "Checking deploy keypair..."
DEPLOYER=$(solana address --keypair "$KEYPAIR_PATH")
ok "Deployer: $DEPLOYER"

step "Checking balance on $NETWORK..."
BALANCE_RAW=$(solana balance "$DEPLOYER" --url "$RPC_URL" 2>/dev/null || echo "0 SOL")
BALANCE_SOL=$(echo "$BALANCE_RAW" | grep -oP '[0-9]+(\.[0-9]+)?' | head -1)
BALANCE_SOL="${BALANCE_SOL:-0}"
ok "Balance: ${BALANCE_SOL} SOL"

if awk "BEGIN {exit !($BALANCE_SOL < 3)}"; then
  err "Insufficient balance (need ~3 SOL). Fund via: https://faucet.solana.com"
  echo "    Address: $DEPLOYER"
  exit 1
fi

step "Building program..."
cargo build-sbf 2>&1

if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  err "Build succeeded but program keypair not found at $PROGRAM_KEYPAIR"
  exit 1
fi

PROGRAM_ID=$(solana address --keypair "$PROGRAM_KEYPAIR")
ok "Program ID: $PROGRAM_ID"

step "Syncing program ID into $API_LIB..."
CURRENT_ID=$(grep -oP "(?<=declare_id!\(\")[A-Za-z0-9]+" "$API_LIB" 2>/dev/null || echo "")

if [ "$CURRENT_ID" = "$PROGRAM_ID" ]; then
  ok "ID already correct"
else
  warn "Patching $API_LIB: $CURRENT_ID → $PROGRAM_ID"
  sed -i "s|declare_id!(\"$CURRENT_ID\")|declare_id!(\"$PROGRAM_ID\")|" "$API_LIB"
  ok "Patched — rebuilding..."
  cargo build-sbf 2>&1
fi

step "Syncing program ID into scripts..."
for SCRIPT in scripts/initialize.js scripts/mint.js scripts/fund.js; do
  if [ -f "$SCRIPT" ]; then
    SCRIPT_ID=$(grep -oP "(?<=new PublicKey\(\")[A-Za-z0-9]+" "$SCRIPT" 2>/dev/null | head -1 || echo "")
    if [ "$SCRIPT_ID" = "$PROGRAM_ID" ]; then
      ok "$SCRIPT already correct"
    else
      sed -i "s|new PublicKey(\"$SCRIPT_ID\")|new PublicKey(\"$PROGRAM_ID\")|" "$SCRIPT"
      ok "Patched $SCRIPT"
    fi
  fi
done

step "Deploying to $NETWORK..."
solana program deploy "$PROGRAM_SO" \
  --keypair "$KEYPAIR_PATH" \
  --program-id "$PROGRAM_KEYPAIR" \
  --url "$RPC_URL" \
  --max-sign-attempts 10

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}  Deploy complete!${RESET}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "  Program ID : $PROGRAM_ID"
echo "  Network    : $NETWORK"
echo ""
echo "  Next steps:"
echo "  1. cd scripts && npm install && node initialize.js"
echo "  2. Copy the printed mint addresses into frontend/js/config.js"
echo ""
