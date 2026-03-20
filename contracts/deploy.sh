#!/usr/bin/env bash
# deploy.sh — One-stop deploy for cf-escrow.
#
# Usage:
#   ./deploy.sh              # devnet (default)
#   ./deploy.sh localnet     # local test validator

set -euo pipefail

NETWORK="${1:-devnet}"
KEYPAIR_PATH="${KEYPAIR_PATH:-$HOME/.config/solana/id.json}"
PROGRAM_SO="target/deploy/cf_escrow_program.so"
PROGRAM_KEYPAIR="target/deploy/cf_escrow_program-keypair.json"
API_LIB="api/src/lib.rs"

case "$NETWORK" in
  devnet)   RPC_URL="https://api.devnet.solana.com" ;;
  localnet) RPC_URL="http://127.0.0.1:8899" ;;
  mainnet)
    echo "ERROR: mainnet deploy not allowed via this script."
    exit 1 ;;
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

# ── Step 1: Solana CLI ────────────────────────────────────────────────────────

step "Checking Solana CLI..."

if ! command -v solana &>/dev/null; then
  warn "Solana CLI not found. Installing now..."
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
  if ! command -v solana &>/dev/null; then
    err "Install succeeded but solana not in PATH."
    echo "    Run: export PATH=\"\$HOME/.local/share/solana/install/active_release/bin:\$PATH\""
    echo "    Then re-run this script."
    exit 1
  fi
fi

ok "$(solana --version)"

# ── Step 2: Deploy keypair ────────────────────────────────────────────────────

step "Checking deploy keypair..."

if [ ! -f "$KEYPAIR_PATH" ]; then
  warn "No keypair at $KEYPAIR_PATH — generating one..."
  solana-keygen new --outfile "$KEYPAIR_PATH" --no-bip39-passphrase --silent
  ok "Keypair created at $KEYPAIR_PATH"
else
  ok "Found keypair at $KEYPAIR_PATH"
fi

DEPLOYER=$(solana address --keypair "$KEYPAIR_PATH")
ok "Deployer: $DEPLOYER"

# ── Step 3: Balance check ─────────────────────────────────────────────────────

step "Checking balance on $NETWORK..."

BALANCE_RAW=$(solana balance "$DEPLOYER" --url "$RPC_URL" 2>/dev/null || echo "0 SOL")
BALANCE_SOL=$(echo "$BALANCE_RAW" | grep -oP '[0-9]+(\.[0-9]+)?' | head -1)
BALANCE_SOL="${BALANCE_SOL:-0}"
ok "Balance: ${BALANCE_SOL} SOL"

if awk "BEGIN {exit !($BALANCE_SOL < 3)}"; then
  echo ""
  err "Insufficient balance (need ~3 SOL for deploy)."
  echo ""
  if [ "$NETWORK" = "devnet" ]; then
    echo "    The CLI faucet is rate-limited. Fund your wallet via the web faucet:"
    echo ""
    echo "    👉  https://faucet.solana.com"
    echo ""
    echo "    Paste this address and request 5 SOL:"
    echo "    $DEPLOYER"
    echo ""
    echo "    Also check for leftover buffer accounts from failed deploys:"
    echo "    solana program show --programs --keypair $KEYPAIR_PATH --url devnet"
    echo "    solana program close <BUFFER_ADDRESS> --keypair $KEYPAIR_PATH --url devnet"
    echo ""
  else
    echo "    Fund your localnet wallet or make sure your test validator is running."
    echo "    solana airdrop 10 $DEPLOYER --url $RPC_URL"
    echo ""
  fi
  exit 1
fi

# ── Step 4: Initial build to generate program keypair ────────────────────────

step "Building program (initial pass)..."

if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  warn "No program keypair yet — building to generate it..."
fi

cargo build-sbf 2>&1

if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  err "Build succeeded but program keypair not found at $PROGRAM_KEYPAIR"
  exit 1
fi

PROGRAM_ID=$(solana address --keypair "$PROGRAM_KEYPAIR")
ok "Program ID: $PROGRAM_ID"

# ── Step 5: Sync program ID into api/src/lib.rs ───────────────────────────────

step "Syncing program ID into $API_LIB..."

if [ ! -f "$API_LIB" ]; then
  err "$API_LIB not found. Run this script from the workspace root."
  exit 1
fi

CURRENT_ID=$(grep -oP "(?<=declare_id!\(\")[A-Za-z0-9]+" "$API_LIB" 2>/dev/null || echo "")

if [ -z "$CURRENT_ID" ]; then
  err "Could not find declare_id!(...) in $API_LIB"
  exit 1
fi

if [ "$CURRENT_ID" = "$PROGRAM_ID" ]; then
  ok "ID already correct in $API_LIB"
else
  warn "Patching $API_LIB: $CURRENT_ID → $PROGRAM_ID"
  sed -i "s|declare_id!(\"$CURRENT_ID\")|declare_id!(\"$PROGRAM_ID\")|" "$API_LIB"
  ok "Patched $API_LIB — rebuilding with correct ID..."
  cargo build-sbf 2>&1
fi

ok "Build complete: $PROGRAM_SO"

# ── Step 6: Deploy ────────────────────────────────────────────────────────────

step "Deploying to $NETWORK..."

solana program deploy "$PROGRAM_SO" \
  --keypair "$KEYPAIR_PATH" \
  --program-id "$PROGRAM_KEYPAIR" \
  --url "$RPC_URL" \
  --max-sign-attempts 10

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}  Deploy complete!${RESET}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "  Program ID : $PROGRAM_ID"
echo "  Network    : $NETWORK"
echo "  Explorer   : https://explorer.solana.com/address/$PROGRAM_ID?cluster=$NETWORK"
echo ""
echo "  Copy these into your frontend .env:"
echo "  VITE_PROGRAM_ID=$PROGRAM_ID"
echo "  VITE_RPC_URL=$RPC_URL"
echo ""
echo ""
