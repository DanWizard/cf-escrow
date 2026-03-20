/**
 * app.js
 * SPA entry point — handles all routes and page logic.
 *
 * Routes:
 *   #provider  — provider dashboard (create / manage escrows)
 *   #client    — client dashboard (commitments where wallet = client)
 *   #accept    — accept an escrow link (#accept?escrow=<PDA>)
 */

import { tryAutoConnect, getPublicKey, isConnected, connect } from "./services/wallet.js";
import {
  fetchLiveEscrows, computeState, fetchClosedState,
  getConnection, fetchEscrowByPda,
} from "./services/chain.js";
import { trackEscrow, markFinalState, getClosedEntries } from "./services/storage.js";
import { cancelEscrow, claimTaskSuccess, claimTaskFailure } from "./services/transactions.js";
import { acceptSol, acceptToken } from "./services/client-transactions.js";
import {
  formatDeadline, formatAmount, truncate, stateLabel, stateBadgeClass,
  datetimeLocalToUnix, defaultDeadline,
} from "./utils/format.js";
import {
  DEFAULT_PUBKEY, PROGRAM_ID, ESCROW_ACCOUNT_SIZE,
  USDC_MINT, USDT_MINT, RECLAIM_GRACE_SECONDS,
} from "./config.js";
import { toast } from "./components/toast-manager.js";
import { route, navigate, routeParams, start } from "./router.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setView(html) {
  document.getElementById("view").innerHTML = html;
}

function showRouteLoading() {
  setView(`
    <div class="main__inner">
      <div class="route-loading">
        <div class="spinner" style="width:28px;height:28px"></div>
      </div>
    </div>
  `);
}

// ── Provider Route ────────────────────────────────────────────────────────────

route("provider", async (signal) => {
  document.getElementById("site-header").setAttribute("active-route", "provider");
  showRouteLoading();

  setView(`
    <div class="main__inner">
      <div id="disconnected-state" class="empty-state">
        <div class="empty-state__icon">◈</div>
        <h2 class="empty-state__title">Connect your wallet</h2>
        <p class="empty-state__text">
          Connect your Solana wallet to view and manage your commitment escrows.
        </p>
      </div>
      <div id="connected-state" class="connected-state" hidden>
        <div class="toolbar">
          <div class="toolbar__left">
            <h2 class="toolbar__title">Your Escrows</h2>
            <span id="escrow-count" class="toolbar__count">—</span>
          </div>
          <button id="create-btn" class="btn btn--primary">
            <span class="btn__icon">+</span> New Escrow
          </button>
        </div>
        <escrow-list id="escrow-list"></escrow-list>
      </div>
    </div>
  `);

  document.getElementById("create-btn").addEventListener("click", () => {
    document.querySelector("create-modal")?.open();
  });

  window.addEventListener("escrow:created", async ({ detail: { pda, deadline } }) => {
    trackEscrow(getPublicKey(), pda, deadline);
    await refreshProviderEscrows();
  }, { signal });

  document.addEventListener("action:cancel",  (e) => cancelEscrowHandler(e.detail.escrow),  { signal });
  document.addEventListener("action:success", (e) => claimSuccessHandler(e.detail.escrow),  { signal });
  document.addEventListener("action:failure", (e) => claimFailureHandler(e.detail.escrow),  { signal });

  window.addEventListener("wallet:connected", () => {
    document.getElementById("disconnected-state").hidden = true;
    document.getElementById("connected-state").hidden = false;
    refreshProviderEscrows();
  }, { signal });

  window.addEventListener("wallet:disconnected", () => {
    document.getElementById("disconnected-state").hidden = false;
    document.getElementById("connected-state").hidden = true;
    document.getElementById("escrow-list")?.setEscrows([]);
  }, { signal });

  if (isConnected()) {
    document.getElementById("disconnected-state").hidden = true;
    document.getElementById("connected-state").hidden = false;
    await refreshProviderEscrows();
  }
});

async function refreshProviderEscrows() {
  const providerPubkey = getPublicKey();
  if (!providerPubkey) return;

  const list = document.getElementById("escrow-list");
  if (!list) return;
  list.setLoading(true);

  try {
    const liveEscrows = await fetchLiveEscrows(providerPubkey);
    const liveMapped  = liveEscrows.map((e) => ({ ...e, state: computeState(e) }));
    const livePdas    = liveMapped.map((e) => e.pda);

    const closedEntries = getClosedEntries(providerPubkey, livePdas);
    const closedMapped  = await Promise.all(
      closedEntries.map(async (entry) => {
        let state = entry.finalState;
        if (!state) {
          state = await fetchClosedState(entry.pda);
          if (state !== "unknown") markFinalState(providerPubkey, entry.pda, state);
        }
        return {
          pda: entry.pda, provider: providerPubkey, client: null,
          mint: null, amount: null, deadline: entry.deadline,
          state: state === "unknown" ? "closed" : state,
        };
      }),
    );

    const all = [...liveMapped, ...closedMapped];
    const countEl = document.getElementById("escrow-count");
    if (countEl) countEl.textContent = `${liveMapped.length} active`;
    if (list) list.setEscrows(all);
  } catch (err) {
    console.error("[provider] refresh:", err);
    toast.error("Failed to load escrows", err.message ?? String(err));
    document.getElementById("escrow-list")?.setEscrows([]);
  }
}

async function cancelEscrowHandler(escrow) {
  if (!confirm("Cancel this escrow? The client has not staked anything yet.")) return;
  const providerPubkey = getPublicKey();
  try {
    const sig = await cancelEscrow(providerPubkey, escrow.deadline);
    markFinalState(providerPubkey, escrow.pda, "cancelled");
    toast.success("Escrow cancelled", `Tx: ${sig.slice(0, 8)}…`);
    await refreshProviderEscrows();
  } catch (err) {
    toast.error("Cancel failed", err.message ?? String(err));
  }
}

async function claimSuccessHandler(escrow) {
  if (!confirm("Mark this task as complete? The client's stake will be returned to them.")) return;
  const providerPubkey = getPublicKey();
  try {
    const sig = await claimTaskSuccess(providerPubkey, escrow.client, escrow.deadline, escrow.mint);
    markFinalState(providerPubkey, escrow.pda, "succeeded");
    toast.success("Task marked complete", `Client refunded. Tx: ${sig.slice(0, 8)}…`);
    await refreshProviderEscrows();
  } catch (err) {
    toast.error("Transaction failed", err.message ?? String(err));
  }
}

async function claimFailureHandler(escrow) {
  if (!confirm("Claim failure? You will receive the client's staked funds.")) return;
  const providerPubkey = getPublicKey();
  try {
    const sig = await claimTaskFailure(providerPubkey, escrow.deadline, escrow.mint);
    markFinalState(providerPubkey, escrow.pda, "failed");
    toast.success("Failure claimed", `Funds transferred to you. Tx: ${sig.slice(0, 8)}…`);
    await refreshProviderEscrows();
  } catch (err) {
    toast.error("Transaction failed", err.message ?? String(err));
  }
}

// ── Client Route ──────────────────────────────────────────────────────────────

route("client", async (signal) => {
  document.getElementById("site-header").setAttribute("active-route", "client");
  showRouteLoading();

  setView(`
    <div class="main__inner">
      <div id="disconnected-state" class="empty-state">
        <div class="empty-state__icon">◈</div>
        <h2 class="empty-state__title">Connect your wallet</h2>
        <p class="empty-state__text">
          Connect your Solana wallet to see all your active and past commitments.
        </p>
      </div>
      <div id="connected-state" hidden>
        <div class="toolbar">
          <div class="toolbar__left">
            <h2 class="toolbar__title">My Commitments</h2>
            <span id="escrow-count" class="toolbar__count">—</span>
          </div>
        </div>
        <div class="escrow-list" id="client-list"></div>
      </div>
    </div>
  `);

  window.addEventListener("wallet:connected", () => {
    document.getElementById("disconnected-state").hidden = true;
    document.getElementById("connected-state").hidden = false;
    loadClientEscrows();
  }, { signal });

  window.addEventListener("wallet:disconnected", () => {
    document.getElementById("disconnected-state").hidden = false;
    document.getElementById("connected-state").hidden = true;
    const list = document.getElementById("client-list");
    if (list) list.innerHTML = "";
  }, { signal });

  if (isConnected()) {
    document.getElementById("disconnected-state").hidden = true;
    document.getElementById("connected-state").hidden = false;
    await loadClientEscrows();
  }
});

async function loadClientEscrows() {
  const clientPubkey = getPublicKey();
  if (!clientPubkey) return;

  const list = document.getElementById("client-list");
  if (!list) return;

  list.innerHTML = `
    <div class="escrow-list__loading">
      <div class="spinner"></div>
      Loading your commitments…
    </div>`;

  try {
    const conn      = getConnection();
    const programId = new window.solanaWeb3.PublicKey(PROGRAM_ID);

    const accounts = await conn.getProgramAccounts(programId, {
      filters: [
        { dataSize: ESCROW_ACCOUNT_SIZE },
        { memcmp: { offset: 40, bytes: clientPubkey } },
      ],
    });

    const escrows = accounts
      .map(({ pubkey, account }) => parseEscrowRaw(pubkey.toBase58(), account.data))
      .filter(Boolean)
      .map((e) => ({ ...e, state: computeState(e) }))
      .sort((a, b) => (b.deadline ?? 0) - (a.deadline ?? 0));

    const countEl = document.getElementById("escrow-count");
    if (countEl) countEl.textContent = `${escrows.length} total`;

    if (!escrows.length) {
      list.innerHTML = `
        <div class="escrow-list__empty">
          <strong>No commitments yet</strong>
          When a provider sends you an escrow link and you accept it, it will appear here.
        </div>`;
      return;
    }

    list.innerHTML = "";
    escrows.forEach((e) => list.appendChild(renderClientCard(e)));
  } catch (err) {
    console.error("[client] load:", err);
    toast.error("Failed to load commitments", err.message ?? String(err));
    list.innerHTML = "";
  }
}

function parseEscrowRaw(pubkey, data) {
  if (!data || data.length < ESCROW_ACCOUNT_SIZE) return null;
  const view    = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const readPk  = (o) => new window.solanaWeb3.PublicKey(data.slice(o, o + 32)).toBase58();
  const readU64 = (o) => { const lo = view.getUint32(o, true), hi = view.getUint32(o + 4, true); return Number(BigInt(lo) + (BigInt(hi) << 32n)); };
  const readI64 = (o) => { const lo = view.getUint32(o, true), hi = view.getInt32(o + 4, true);  return Number(BigInt(lo) + (BigInt(hi) << 32n)); };
  return {
    pda: pubkey, provider: readPk(8), client: readPk(40), mint: readPk(72),
    amount: readU64(104), deadline: readI64(112),
  };
}

function renderClientCard(e) {
  const now      = Math.floor(Date.now() / 1000);
  const isOverdue = e.state === "accepted_overdue";
  const canReclaim = now > e.deadline + RECLAIM_GRACE_SECONDS;

  const card = document.createElement("div");
  card.className = "escrow-card";
  card.innerHTML = `
    <div class="escrow-card__body">
      <div class="escrow-card__top">
        <span class="escrow-card__pda">${truncate(e.pda, 6)}</span>
        <span class="badge badge--${stateBadgeClass(e.state)}">
          <span class="badge__dot"></span>
          ${e.state === "accepted" ? "Active" : e.state === "accepted_overdue" ? "Past Deadline" : stateLabel(e.state)}
        </span>
        ${isOverdue  ? `<span class="tag tag--deadline">Past Deadline</span>`     : ""}
        ${canReclaim ? `<span class="tag tag--deadline">Reclaim Available</span>` : ""}
      </div>
      <div class="escrow-card__data">
        <div class="data-item">
          <span class="data-item__label">Staked</span>
          <span class="data-item__value data-item__value--accent">${formatAmount(e.amount, e.mint)}</span>
        </div>
        <div class="data-item">
          <span class="data-item__label">Deadline</span>
          <span class="data-item__value">${formatDeadline(e.deadline)}</span>
        </div>
        <div class="data-item">
          <span class="data-item__label">Provider</span>
          <span class="data-item__value data-item__value--muted">${truncate(e.provider)}</span>
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
    setTimeout(() => { ev.target.textContent = "⎘ Copy ID"; }, 2000);
  });

  return card;
}

// ── Accept Route ──────────────────────────────────────────────────────────────

route("accept", async (signal) => {
  document.getElementById("site-header").setAttribute("active-route", "client");

  const { escrow: pda } = routeParams();

  setView(`
    <div class="main__inner">
      <div class="accept-shell" id="accept-shell">
        <div id="state-loading" class="empty-state">
          <div class="spinner" style="width:32px;height:32px;margin-bottom:20px"></div>
          <p style="color:var(--text-muted);font-size:14px">Loading escrow…</p>
        </div>
        <div id="state-error" class="empty-state" hidden>
          <div class="empty-state__icon">⚠</div>
          <h2 class="empty-state__title">Invalid link</h2>
          <p class="empty-state__text" id="error-msg">This escrow link is missing required parameters.</p>
        </div>
        <div id="state-taken" class="empty-state" hidden>
          <div class="empty-state__icon">🔒</div>
          <h2 class="empty-state__title">Escrow already accepted</h2>
          <p class="empty-state__text">Someone has already staked on this commitment. It is no longer open.</p>
        </div>
        <div id="state-expired" class="empty-state" hidden>
          <div class="empty-state__icon">⏰</div>
          <h2 class="empty-state__title">Deadline has passed</h2>
          <p class="empty-state__text">This commitment expired on <strong id="expired-date"></strong>. You can no longer accept it.</p>
        </div>
        <div id="state-success" class="empty-state" hidden>
          <div class="empty-state__icon" style="color:var(--green)">✓</div>
          <h2 class="empty-state__title">Commitment accepted!</h2>
          <p class="empty-state__text">Your stake has been locked. Good luck — you've got this.</p>
          <div class="success-details" id="success-details"></div>
        </div>
        <div id="state-form" hidden></div>
      </div>
    </div>
  `);

  const showState = (name) => {
    ["loading", "error", "taken", "expired", "success", "form"].forEach((s) => {
      const el = document.getElementById("state-" + s);
      if (el) el.hidden = s !== name;
    });
  };

  if (!pda) {
    showState("error");
    document.getElementById("error-msg").textContent =
      "No escrow address in this link. Ask your provider to resend it.";
    return;
  }

  let escrow;
  try {
    escrow = await fetchEscrowByPda(pda);
    if (!escrow) {
      showState("error");
      document.getElementById("error-msg").textContent = "Escrow not found. It may have been cancelled.";
      return;
    }
    if (escrow.client !== DEFAULT_PUBKEY) { showState("taken"); return; }

    const now = Math.floor(Date.now() / 1000);
    if (escrow.deadline > 0 && escrow.deadline < now) {
      showState("expired");
      document.getElementById("expired-date").textContent = formatDeadline(escrow.deadline);
      return;
    }
  } catch (err) {
    showState("error");
    document.getElementById("error-msg").textContent = "Failed to load: " + (err.message ?? String(err));
    return;
  }

  renderAcceptForm(escrow, showState, signal);
});

function renderAcceptForm(escrow, showState, signal) {
  document.getElementById("state-form").innerHTML = `
    <div class="accept-card">
      <div class="accept-card__header">
        <div class="accept-card__icon">◈</div>
        <div>
          <h1 class="accept-card__title">Commitment Escrow</h1>
          <p class="accept-card__sub">Review the terms and stake your commitment</p>
        </div>
      </div>
      <div class="terms-box">
        <div class="terms-box__label">Terms set by your provider</div>
        <div class="terms-row">
          <div class="terms-item">
            <span class="terms-item__label">Deadline</span>
            <span class="terms-item__value" id="term-deadline">You choose it below</span>
          </div>
          <div class="terms-item">
            <span class="terms-item__label">Escrow ID</span>
            <span class="terms-item__value terms-item__value--mono" id="term-pda">${truncate(escrow.pda, 8)}</span>
          </div>
        </div>
      </div>
      <div class="stake-form">
        <div class="stake-form__title">Your stake</div>
        <p class="stake-form__hint">
          Choose how much you want to commit. The funds are held in escrow until your
          provider marks the task complete, failed, or the deadline passes.
        </p>
        <div class="form-group">
          <label class="form-label">Asset</label>
          <div class="asset-picker" id="asset-picker">
            <button class="asset-btn asset-btn--selected" data-asset="SOL">
              <span class="asset-btn__icon">◎</span>SOL
            </button>
            <button class="asset-btn" data-asset="USDC">
              <span class="asset-btn__icon">$</span>USDC
            </button>
            <button class="asset-btn" data-asset="USDT">
              <span class="asset-btn__icon">$</span>USDT
            </button>
          </div>
        </div>
        <div class="form-group" id="deadline-group">
          <label class="form-label" for="client-deadline-input">Your Deadline</label>
          <input class="form-input" type="datetime-local" id="client-deadline-input"
            value="${defaultDeadline(7)}" />
          <span class="form-hint">Commit to completing this task by this date. Your provider
            will judge success or failure once the deadline passes.</span>
        </div>
        <div class="form-group">
          <label class="form-label" for="amount-input">Amount</label>
          <div class="amount-wrapper">
            <input class="form-input amount-input" type="number" id="amount-input"
              placeholder="0.00" min="0" step="any" />
            <span class="amount-unit" id="amount-unit">SOL</span>
          </div>
          <span class="form-hint" id="balance-hint">Connect wallet to see balance</span>
        </div>
        <div id="wallet-not-connected">
          <button class="btn btn--primary btn--full" id="connect-to-stake-btn">
            Connect Wallet to Stake
          </button>
        </div>
        <div id="wallet-connected-actions" hidden>
          <button class="btn btn--primary btn--full" id="stake-btn">
            <span id="stake-label">Stake &amp; Accept</span>
          </button>
        </div>
      </div>
    </div>
  `;

  showState("form");

  let selectedAsset = "SOL";

  const updateWalletUI = () => {
    document.getElementById("wallet-not-connected").hidden = isConnected();
    document.getElementById("wallet-connected-actions").hidden = !isConnected();
    if (isConnected()) updateAcceptBalanceHint(selectedAsset);
  };

  window.addEventListener("wallet:connected",    updateWalletUI, { signal });
  window.addEventListener("wallet:disconnected", updateWalletUI, { signal });

  document.getElementById("asset-picker").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-asset]");
    if (!btn) return;
    selectedAsset = btn.dataset.asset;
    document.querySelectorAll(".asset-btn").forEach((b) => b.classList.remove("asset-btn--selected"));
    btn.classList.add("asset-btn--selected");
    document.getElementById("amount-unit").textContent = selectedAsset;
    updateAcceptBalanceHint(selectedAsset);
  });

  document.getElementById("connect-to-stake-btn").addEventListener("click", async () => {
    try { await connect(); } catch (err) { toast.error("Connection failed", err.message); }
  });

  document.getElementById("stake-btn").addEventListener("click", () =>
    onAcceptStake(escrow, () => selectedAsset, showState),
  );

  updateWalletUI();
}

async function updateAcceptBalanceHint(asset) {
  if (!isConnected()) return;
  const hint = document.getElementById("balance-hint");
  if (!hint) return;
  try {
    const pubkey = getPublicKey();
    const conn   = getConnection();
    if (asset === "SOL") {
      const lam = await conn.getBalance(new window.solanaWeb3.PublicKey(pubkey));
      hint.textContent = "Balance: " + (lam / 1e9).toFixed(4) + " SOL";
    } else {
      const mint = asset === "USDC" ? USDC_MINT : USDT_MINT;
      const resp = await conn.getParsedTokenAccountsByOwner(
        new window.solanaWeb3.PublicKey(pubkey),
        { mint: new window.solanaWeb3.PublicKey(mint) },
      );
      hint.textContent = resp.value.length
        ? "Balance: " + resp.value[0].account.data.parsed.info.tokenAmount.uiAmountString + " " + asset
        : "No " + asset + " account found";
    }
  } catch { /* ignore */ }
}

async function onAcceptStake(escrow, getAsset, showState) {
  const amount = parseFloat(document.getElementById("amount-input").value);
  if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }

  const deadlineEl = document.getElementById("client-deadline-input");
  if (!deadlineEl?.value) { toast.error("Please set your deadline"); return; }
  const clientDeadline = datetimeLocalToUnix(deadlineEl.value);
  if (clientDeadline <= Math.floor(Date.now() / 1000)) {
    toast.error("Deadline must be in the future"); return;
  }

  const stakeBtn = document.getElementById("stake-btn");
  stakeBtn.disabled = true;
  document.getElementById("stake-label").textContent = "Staking...";

  try {
    const asset        = getAsset();
    const clientPubkey = getPublicKey();
    const pdaDeadline  = escrow.deadline;
    let sig;
    if (asset === "SOL") {
      sig = await acceptSol(clientPubkey, escrow.provider, pdaDeadline, clientDeadline, Math.floor(amount * 1e9));
    } else {
      const mint = asset === "USDC" ? USDC_MINT : USDT_MINT;
      sig = await acceptToken(clientPubkey, escrow.provider, pdaDeadline, clientDeadline, Math.floor(amount * 1e6), mint);
    }

    showState("success");
    document.getElementById("success-details").innerHTML =
      "Asset   : " + asset + "<br>" +
      "Amount  : " + amount + " " + asset + "<br>" +
      "Deadline: " + formatDeadline(clientDeadline) + "<br>" +
      "Tx      : " + sig.slice(0, 16) + "...";

    setTimeout(() => navigate("client"), 2500);
  } catch (err) {
    console.error("[accept] stake:", err);
    toast.error("Stake failed", err.message ?? String(err));
    stakeBtn.disabled = false;
    document.getElementById("stake-label").textContent = "Stake & Accept";
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Show spinner while auto-connect runs, then start router
setView(`
  <div class="main__inner">
    <div class="route-loading">
      <div class="spinner" style="width:28px;height:28px"></div>
    </div>
  </div>
`);

await tryAutoConnect();
start();
