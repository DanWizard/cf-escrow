/**
 * escrow-card.js
 * <escrow-card> — fixed 600px wide card, collapses to compact on mobile.
 * On mobile a ⓘ button opens an info modal with full details.
 */

import {
  truncate,
  formatDeadline,
  formatAmount,
  stateLabel,
  stateBadgeClass,
} from "../utils/format.js";
import { DEFAULT_PUBKEY } from "../config.js";

class EscrowCard extends HTMLElement {
  set escrow(value) {
    this._escrow = value;
    this._render();
  }
  get escrow() {
    return this._escrow;
  }
  connectedCallback() {
    if (this._escrow) this._render();
  }

  _render() {
    const e = this._escrow;
    if (!e) return;
    const state = e.state;
    const isOverdue = state === "accepted_overdue";
    const isAccepted = state === "accepted" || isOverdue;
    const isPending = state === "unaccepted";
    const hasClient = e.client && e.client !== DEFAULT_PUBKEY;
    const isClosed = [
      "succeeded",
      "failed",
      "reclaimed",
      "cancelled",
      "closed",
    ].includes(state);

    const badgeClass = stateBadgeClass(state);
    const label = stateLabel(state);
    const overdueTag = isOverdue
      ? `<span class="tag tag--deadline">PAST DL</span>`
      : "";

    const clientUrl =
      location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html?escrow=" + e.pda;

    let actionBtns = "";
    if (isPending) {
      actionBtns = `<button class="btn btn--danger btn--sm" data-action="cancel">Cancel</button>`;
    }
    if (isAccepted) {
      actionBtns = `<button class="btn btn--success btn--sm" data-action="success">Complete</button>`;
      if (isOverdue)
        actionBtns += `<button class="btn btn--warning btn--sm" data-action="failure">Failure</button>`;
    }

    const clientLinkBtn = !isClosed && !hasClient
      ? `<button class="btn btn--link btn--sm" data-action="copy-link">⎘ Client Link</button>`
      : "";

    this.innerHTML = `
      <div class="escrow-card">
        <div class="escrow-card__body">

          <div class="escrow-card__top">
            <span class="escrow-card__pda">${truncate(e.pda, 6)}</span>
            <span class="badge badge--${badgeClass}">
              <span class="badge__dot"></span>${label}
            </span>
            ${overdueTag}
          </div>

          <!-- Full data: visible on desktop (≥600px) -->
          <div class="escrow-card__data card-data--full">
            <div class="data-item">
              <span class="data-item__label">Amount</span>
              <span class="data-item__value data-item__value--accent">${formatAmount(e.amount, e.mint)}</span>
            </div>
            <div class="data-item">
              <span class="data-item__label">Deadline</span>
              <span class="data-item__value">${formatDeadline(e.deadline)}</span>
            </div>
            <div class="data-item">
              <span class="data-item__label">Client</span>
              <span class="data-item__value data-item__value--muted">${hasClient ? truncate(e.client) : "—"}</span>
            </div>
          </div>

          <!-- Compact: visible only on mobile (<600px) -->
          <div class="escrow-card__compact card-data--compact">
            <span class="data-item__value data-item__value--accent">${formatAmount(e.amount, e.mint)}</span>
            <span class="data-item__value" style="color:var(--text-muted);font-size:11px;">${formatDeadline(e.deadline)}</span>
          </div>

        </div>

        <div class="escrow-card__actions">
          ${actionBtns}
          ${clientLinkBtn}
          <button class="escrow-card__copy-btn" data-action="copy">⎘ Copy ID</button>
          <!-- Mobile info button -->
          <button class="escrow-card__info-btn card-info--mobile" data-action="info" title="Details">ⓘ</button>
        </div>
      </div>

      <!-- Info modal (hidden by default) -->
      <div class="card-info-modal" id="info-modal-${e.pda.slice(0, 8)}" hidden>
        <div class="card-info-modal__inner">
          <div class="card-info-modal__header">
            <span>Escrow Details</span>
            <button class="card-info-modal__close" data-action="close-info">✕</button>
          </div>
          <div class="card-info-modal__body">
            <div class="info-row"><span>PDA</span><span class="mono">${truncate(e.pda, 8)}</span></div>
            <div class="info-row"><span>State</span><span>${label}</span></div>
            <div class="info-row"><span>Amount</span><span>${formatAmount(e.amount, e.mint)}</span></div>
            <div class="info-row"><span>Deadline</span><span>${formatDeadline(e.deadline)}</span></div>
            <div class="info-row"><span>Client</span><span class="mono">${hasClient ? truncate(e.client, 8) : "—"}</span></div>
            <div class="info-row"><span>Provider</span><span class="mono">${truncate(e.provider, 8)}</span></div>
          </div>
        </div>
      </div>
    `;

    const modal = this.querySelector(`#info-modal-${e.pda.slice(0, 8)}`);

    this.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "copy") {
          navigator.clipboard.writeText(e.pda).catch(() => {});
          btn.textContent = "✓ Copied";
          setTimeout(() => {
            btn.textContent = "⎘ Copy ID";
          }, 2000);
          return;
        }
        if (action === "copy-link") {
          navigator.clipboard.writeText(clientUrl).catch(() => {});
          btn.textContent = "✓ Copied";
          setTimeout(() => {
            btn.textContent = "⎘ Client Link";
          }, 2000);
          return;
        }
        if (action === "info") {
          modal.hidden = false;
          return;
        }
        if (action === "close-info") {
          modal.hidden = true;
          return;
        }
        this.dispatchEvent(
          new CustomEvent(`action:${action}`, {
            bubbles: true,
            detail: { escrow: e },
          }),
        );
      });
    });
  }
}

if (!document.getElementById("escrow-card-styles")) {
  const s = document.createElement("style");
  s.id = "escrow-card-styles";
  s.textContent = `
    .btn--sm   { padding: 3px 8px; font-size: 11px; }
    .btn--link {
      display: inline-flex; align-items: center; gap: 4px;
      background: transparent; border: 1px solid #226666;
      color: #55ffff; font-size: 11px; font-family: var(--font);
      font-weight: 500; padding: 3px 8px; cursor: pointer;
      transition: background 100ms ease;
    }
    .btn--link:hover { background: rgba(85,255,255,.08); }

    /* Desktop: show full data, hide compact + info btn */
    .card-data--compact { display: none; }
    .card-info--mobile  { display: none; }

    /* Mobile: hide full data, show compact + info btn */
    @media (max-width: 599px) {
      .card-data--full    { display: none; }
      .card-data--compact {
        display: flex; flex-direction: column; gap: 2px; margin-top: 6px;
      }
      .card-info--mobile {
        display: inline-flex; background: none; border: 1px solid var(--border-2);
        color: var(--text-dim); font-size: 13px; font-family: var(--font);
        padding: 3px 8px; cursor: pointer; transition: color 80ms ease;
      }
      .card-info--mobile:hover { color: var(--text-muted); }
    }

    /* Info modal */
    .card-info-modal {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.82);
      z-index: 300;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .card-info-modal[hidden] { display: none !important; }
    .card-info-modal__inner {
      background: var(--surface);
      border: 1px solid var(--border-2);
      width: 100%; max-width: 360px;
    }
    .card-info-modal__header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 9px 14px; border-bottom: 1px solid var(--border);
      font-size: 12px; color: var(--text-muted);
    }
    .card-info-modal__close {
      background: none; border: none; color: var(--text-dim);
      font-size: 13px; font-family: var(--font); cursor: pointer;
      transition: color 80ms ease;
    }
    .card-info-modal__close:hover { color: var(--text-muted); }
    .card-info-modal__body { padding: 14px; }
    .info-row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 6px 0; border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    .info-row:last-child { border-bottom: none; }
    .info-row span:first-child { color: var(--text-dim); font-size: 11px; }
    .info-row span:last-child  { color: var(--text); }
    .info-row .mono { font-size: 11px; color: var(--text-muted); }
  `;
  document.head.appendChild(s);
}

customElements.define("escrow-card", EscrowCard);
