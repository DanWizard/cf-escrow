/**
 * accept.js — acceptance page (accept.html)
 *
 * ─── DEADLINE OWNERSHIP ────────────────────────────────────────────────────────
 *
 * CLIENT-SETS-DEADLINE (active):
 *   Provider creates the escrow with a far-future sentinel deadline so the contract
 *   accepts the Create instruction (deadline must be > now). The client picks
 *   their own meaningful deadline in the accept form below.
 *
 *   The client's deadline is currently UI-only: acceptSol/acceptToken still
 *   receives the provider's sentinel deadline for PDA derivation (because PDA seeds
 *   are fixed at Create time). Once the contract is updated so that:
 *     - Accept { amount, mint, deadline } stores the deadline on-chain
 *     - PDA seed uses a nonce instead of the provider's deadline
 *   …wire `pdaDeadline` → nonce, and pass `clientDeadline` as instruction data.
 *   See: contracts/api/src/instruction.rs, contracts/program/src/{create,accept}.rs
 *
 * PROVIDER-SETS-DEADLINE (commented out — search "PROVIDER-SETS-DEADLINE"):
 *   Deadline is stored on-chain at Create time. Client just sees and accepts it.
 *   Swap the labelled blocks to revert to this mode with no other changes.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

import {
  connect,
  isConnected,
  getPublicKey,
  tryAutoConnect,
} from "./services/wallet.js";
import {
  getConnection,
  fetchEscrowByPda,
  computeState,
} from "./services/chain.js";
import { acceptSol, acceptToken } from "./services/client-transactions.js";
import {
  formatDeadline,
  truncate,
  datetimeLocalToUnix,
  defaultDeadline,
} from "./utils/format.js";
import { toast } from "./components/toast-manager.js";
import { DEFAULT_PUBKEY, USDC_MINT, USDT_MINT } from "./config.js";

let _escrow = null;
let _selectedAsset = "SOL";

// ── DOM ───────────────────────────────────────────────────────────────────────

const states = {
  loading: document.getElementById("state-loading"),
  error:   document.getElementById("state-error"),
  taken:   document.getElementById("state-taken"),
  expired: document.getElementById("state-expired"),
  form:    document.getElementById("state-form"),
  success: document.getElementById("state-success"),
};

function showState(name) {
  Object.values(states).forEach((el) => { if (el) el.hidden = true; });
  if (states[name]) states[name].hidden = false;
}

// ── Wallet events ─────────────────────────────────────────────────────────────

window.addEventListener("wallet:connected", () => onWalletConnected());

window.addEventListener("wallet:disconnected", () => {
  const wc = document.getElementById("wallet-connected-actions");
  const nc = document.getElementById("wallet-not-connected");
  if (wc) wc.hidden = true;
  if (nc) nc.hidden = false;
});

function onWalletConnected() {
  const nc = document.getElementById("wallet-not-connected");
  const wc = document.getElementById("wallet-connected-actions");
  if (nc) nc.hidden = true;
  if (wc) wc.hidden = false;
  updateBalanceHint();
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await tryAutoConnect();

  const pda = new URLSearchParams(location.search).get("escrow");
  if (!pda) {
    showState("error");
    document.getElementById("error-msg").textContent =
      "No escrow address in this link. Ask your provider to resend it.";
    return;
  }

  try {
    _escrow = await fetchEscrowByPda(pda);
    if (!_escrow) {
      showState("error");
      document.getElementById("error-msg").textContent =
        "Escrow not found. It may have been cancelled.";
      return;
    }

    if (_escrow.client !== DEFAULT_PUBKEY) {
      showState("taken");
      return;
    }

    // ── CLIENT-SETS-DEADLINE (active): skip expiry check on provider's sentinel ──
    // The provider's deadline is a far-future sentinel so this check would never
    // trigger in normal use. We still guard against an accidental past deadline.
    const now = Math.floor(Date.now() / 1000);
    if (_escrow.deadline > 0 && _escrow.deadline < now) {
      showState("expired");
      document.getElementById("expired-date").textContent =
        formatDeadline(_escrow.deadline);
      return;
    }

    // ── PROVIDER-SETS-DEADLINE (commented out): ───────────────────────────────
    // Strict expiry check: the provider's deadline is the real deadline.
    //
    // const now = Math.floor(Date.now() / 1000);
    // if (_escrow.deadline > 0 && now > _escrow.deadline) {
    //   showState('expired');
    //   document.getElementById('expired-date').textContent =
    //     formatDeadline(_escrow.deadline);
    //   return;
    // }
    // ─────────────────────────────────────────────────────────────────────────

    renderForm();
  } catch (err) {
    console.error("[accept] init:", err);
    showState("error");
    document.getElementById("error-msg").textContent =
      "Failed to load: " + (err.message ?? String(err));
  }
}

// ── Form ──────────────────────────────────────────────────────────────────────

function renderForm() {
  showState("form");

  // ── CLIENT-SETS-DEADLINE (active): deadline term shows placeholder; ─────────
  // the actual deadline-group input is revealed so the client can fill it in.
  document.getElementById("term-deadline").textContent = "You choose it below";
  const deadlineGroup = document.getElementById("deadline-group");
  if (deadlineGroup) {
    deadlineGroup.hidden = false;
    const deadlineInput = document.getElementById("client-deadline-input");
    if (deadlineInput) deadlineInput.value = defaultDeadline(7);
  }

  // ── PROVIDER-SETS-DEADLINE (commented out): show the provider's on-chain deadline.
  // document.getElementById('term-deadline').textContent =
  //   formatDeadline(_escrow.deadline);
  // ─────────────────────────────────────────────────────────────────────────────

  document.getElementById("term-pda").textContent = truncate(_escrow.pda, 8);

  document.getElementById("asset-picker").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-asset]");
    if (!btn) return;
    _selectedAsset = btn.dataset.asset;
    document
      .querySelectorAll(".asset-btn")
      .forEach((b) => b.classList.remove("asset-btn--selected"));
    btn.classList.add("asset-btn--selected");
    document.getElementById("amount-unit").textContent = _selectedAsset;
    updateBalanceHint();
  });

  document
    .getElementById("connect-to-stake-btn")
    .addEventListener("click", async () => {
      try {
        await connect();
      } catch (err) {
        toast.error("Connection failed", err.message);
      }
    });

  document.getElementById("stake-btn").addEventListener("click", onStake);

  if (isConnected()) onWalletConnected();
}

async function updateBalanceHint() {
  if (!isConnected()) return;
  const hint   = document.getElementById("balance-hint");
  const pubkey = getPublicKey();
  const conn   = getConnection();
  if (!hint || !pubkey) return;
  try {
    if (_selectedAsset === "SOL") {
      const lam = await conn.getBalance(new window.solanaWeb3.PublicKey(pubkey));
      hint.textContent = "Balance: " + (lam / 1e9).toFixed(4) + " SOL";
    } else {
      const mint = _selectedAsset === "USDC" ? USDC_MINT : USDT_MINT;
      const resp = await conn.getParsedTokenAccountsByOwner(
        new window.solanaWeb3.PublicKey(pubkey),
        { mint: new window.solanaWeb3.PublicKey(mint) },
      );
      if (resp.value.length) {
        const amt =
          resp.value[0].account.data.parsed.info.tokenAmount.uiAmountString;
        hint.textContent = "Balance: " + amt + " " + _selectedAsset;
      } else {
        hint.textContent = "No " + _selectedAsset + " account found";
      }
    }
  } catch {
    hint.textContent = "";
  }
}

async function onStake() {
  const amount = parseFloat(document.getElementById("amount-input").value);
  if (!amount || amount <= 0) {
    toast.error("Enter a valid amount");
    return;
  }

  const clientPubkey   = getPublicKey();
  const providerPubkey = _escrow.provider;

  // ── DEADLINE RESOLUTION ────────────────────────────────────────────────────
  //
  // CLIENT-SETS-DEADLINE (active):
  //   Client picks their own commitment deadline in the form.
  //   `pdaDeadline` stays as the provider's sentinel so PDA derivation is correct
  //   (PDA was seeded with the sentinel at Create time and cannot change).
  //   `clientDeadline` will be passed as Accept instruction data once the
  //   contract is updated — see the TODO note at the top of this file.
  //
  const deadlineInputEl = document.getElementById("client-deadline-input");
  if (!deadlineInputEl || !deadlineInputEl.value) {
    toast.error("Please set your deadline");
    return;
  }
  const clientDeadline = datetimeLocalToUnix(deadlineInputEl.value);
  if (clientDeadline <= Math.floor(Date.now() / 1000)) {
    toast.error("Deadline must be in the future");
    return;
  }
  // PDA derivation uses the provider's sentinel — do NOT use clientDeadline here.
  const pdaDeadline = _escrow.deadline;

  // ── PROVIDER-SETS-DEADLINE (commented out): deadline already on-chain. ───────
  // const clientDeadline = _escrow.deadline;
  // const pdaDeadline    = _escrow.deadline;
  // ─────────────────────────────────────────────────────────────────────────────

  const stakeBtn = document.getElementById("stake-btn");
  stakeBtn.disabled = true;
  document.getElementById("stake-label").textContent = "Staking...";

  try {
    let sig;
    if (_selectedAsset === "SOL") {
      sig = await acceptSol(
        clientPubkey,
        providerPubkey,
        pdaDeadline,
        Math.floor(amount * 1_000_000_000),
      );
    } else {
      const mint = _selectedAsset === "USDC" ? USDC_MINT : USDT_MINT;
      sig = await acceptToken(
        clientPubkey,
        providerPubkey,
        pdaDeadline,
        Math.floor(amount * 1_000_000),
        mint,
      );
    }

    showState("success");
    document.getElementById("success-details").innerHTML =
      "Asset   : " + _selectedAsset + "<br>" +
      "Amount  : " + amount + " " + _selectedAsset + "<br>" +
      "Deadline: " + formatDeadline(clientDeadline) + "<br>" +
      "Tx      : " + sig.slice(0, 16) + "...";

    setTimeout(() => {
      const base = location.href.replace(/[^/]*$/, "");
      location.href = base + "client.html";
    }, 2500);
  } catch (err) {
    console.error("[accept] onStake:", err);
    toast.error("Stake failed", err.message ?? String(err));
    stakeBtn.disabled = false;
    document.getElementById("stake-label").textContent = "Stake & Accept";
  }
}

init();
