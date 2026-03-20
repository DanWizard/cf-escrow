/**
 * client.js
 * Controller for index.html — the student/client dashboard.
 *
 * Shows all escrows where the connected wallet is the client (student).
 * Fetches via memcmp on bytes 40..72 (client field in Escrow struct).
 *
 * Wallet UI (connect button, switch wallet, disconnect dropdown) is handled
 * entirely by the <wallet-header> component — no manual button wiring needed here.
 */

import { getPublicKey, tryAutoConnect } from "./services/wallet.js";
import { getConnection, computeState } from "./services/chain.js";
import {
  formatDeadline,
  formatAmount,
  truncate,
  stateLabel,
  stateBadgeClass,
} from "./utils/format.js";
import {
  DEFAULT_PUBKEY,
  PROGRAM_ID,
  ESCROW_ACCOUNT_SIZE,
  RECLAIM_GRACE_SECONDS,
} from "./config.js";
import { toast } from "./components/toast-manager.js";

// ── DOM ───────────────────────────────────────────────────────────────────────

const disconnectedState = document.getElementById("disconnected-state");
const connectedState    = document.getElementById("connected-state");
const clientList        = document.getElementById("client-list");
const escrowCount       = document.getElementById("escrow-count");

// ── Wallet events ─────────────────────────────────────────────────────────────

window.addEventListener("wallet:connected", () => {
  disconnectedState.hidden = true;
  connectedState.hidden    = false;
  loadEscrows();
});

window.addEventListener("wallet:disconnected", () => {
  disconnectedState.hidden = false;
  connectedState.hidden    = true;
  clientList.innerHTML    = "";
});

// ── Fetch escrows where wallet = client ───────────────────────────────────────

async function loadEscrows() {
  const clientPubkey = getPublicKey();
  if (!clientPubkey) return;

  clientList.innerHTML = `
    <div class="escrow-list__loading">
      <div class="spinner"></div>
      Loading your commitments…
    </div>`;

  try {
    const conn = getConnection();
    const programId = new window.solanaWeb3.PublicKey(PROGRAM_ID);

    // Filter: dataSize = 128, client field starts at byte 40
    const accounts = await conn.getProgramAccounts(programId, {
      filters: [
        { dataSize: ESCROW_ACCOUNT_SIZE },
        { memcmp: { offset: 40, bytes: clientPubkey } },
      ],
    });

    const escrows = accounts
      .map(({ pubkey, account }) =>
        parseEscrow(pubkey.toBase58(), account.data),
      )
      .filter(Boolean)
      .map((e) => ({ ...e, state: computeState(e) }))
      .sort((a, b) => (b.deadline ?? 0) - (a.deadline ?? 0));

    escrowCount.textContent = `${escrows.length} total`;

    if (!escrows.length) {
      clientList.innerHTML = `
        <div class="escrow-list__empty">
          <strong>No commitments yet</strong>
          When a provider sends you an escrow link and you accept it, it will appear here.
        </div>`;
      return;
    }

    clientList.innerHTML = "";
    escrows.forEach((e) => clientList.appendChild(renderCard(e)));
  } catch (err) {
    console.error("[client] loadEscrows:", err);
    toast.error("Failed to load commitments", err.message ?? String(err));
    clientList.innerHTML = "";
  }
}

// ── Parse escrow account data ─────────────────────────────────────────────────

function readPubkey(data, offset) {
  return new window.solanaWeb3.PublicKey(
    data.slice(offset, offset + 32),
  ).toBase58();
}

function readU64(view, offset) {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return Number(BigInt(lo) + (BigInt(hi) << 32n));
}

function readI64(view, offset) {
  const lo = view.getUint32(offset, true);
  const hi = view.getInt32(offset + 4, true);
  return Number(BigInt(lo) + (BigInt(hi) << 32n));
}

function parseEscrow(pubkey, data) {
  if (!data || data.length < ESCROW_ACCOUNT_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    pda: pubkey,
    provider: readPubkey(data, 8),
    client:   readPubkey(data, 40),
    mint:     readPubkey(data, 72),
    amount:   readU64(view, 104),
    deadline: readI64(view, 112),
  };
}

// ── Render a single escrow card ───────────────────────────────────────────────

function renderCard(e) {
  const now = Math.floor(Date.now() / 1000);
  const state = e.state;
  const isOverdue = state === "accepted_overdue";
  const reclaimAt = e.deadline + RECLAIM_GRACE_SECONDS;
  const canReclaim = now > reclaimAt;

  const badgeClass = stateBadgeClass(state);
  const label =
    state === "accepted"
      ? "Active"
      : state === "accepted_overdue"
        ? "Past Deadline"
        : stateLabel(state);

  const overdueTag = isOverdue
    ? `<span class="tag tag--deadline">Past Deadline</span>`
    : "";

  const reclaimTag = canReclaim
    ? `<span class="tag tag--deadline">Reclaim Available</span>`
    : "";

  const card = document.createElement("div");
  card.className = "escrow-card";
  card.innerHTML = `
    <div class="escrow-card__body">
      <div class="escrow-card__top">
        <span class="escrow-card__pda">${truncate(e.pda, 6)}</span>
        <span class="badge badge--${badgeClass}">
          <span class="badge__dot"></span>
          ${label}
        </span>
        ${overdueTag}
        ${reclaimTag}
      </div>
      <div class="escrow-card__data">
        <div class="data-item">
          <span class="data-item__label">Staked</span>
          <span class="data-item__value data-item__value--accent">
            ${formatAmount(e.amount, e.mint)}
          </span>
        </div>
        <div class="data-item">
          <span class="data-item__label">Deadline</span>
          <span class="data-item__value">${formatDeadline(e.deadline)}</span>
        </div>
        <div class="data-item">
          <span class="data-item__label">Provider</span>
          <span class="data-item__value data-item__value--muted">
            ${truncate(e.provider)}
          </span>
        </div>
      </div>
    </div>
    <div class="escrow-card__actions">
      <button class="escrow-card__copy-btn" data-pda="${e.pda}">⎘ Copy ID</button>
    </div>
  `;

  card.querySelector("[data-pda]").addEventListener("click", (ev) => {
    navigator.clipboard.writeText(e.pda).catch(() => {});
    ev.target.textContent = "✓ Copied";
    setTimeout(() => {
      ev.target.textContent = "⎘ Copy ID";
    }, 2000);
  });

  return card;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

tryAutoConnect();
