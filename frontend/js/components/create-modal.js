/**
 * create-modal.js
 * Provider creates an escrow. Deadline is currently set by the STUDENT on accept.
 *
 * ─── DEADLINE OWNERSHIP ────────────────────────────────────────────────────────
 *
 * STUDENT-SETS-DEADLINE (active):
 *   Provider creates the escrow with a far-future sentinel deadline (~10 years).
 *   The sentinel is needed because the on-chain Create instruction currently
 *   requires deadline > now. The client sets a real, meaningful deadline when
 *   they accept the escrow in client.html.
 *
 *   Full contract support requires:
 *     - Create: allow a sentinel / no meaningful deadline
 *     - Accept: add `deadline: i64` to instruction data; store it in Escrow
 *     - PDA seed: swap (provider, deadline) → (provider, nonce) so the seed
 *       doesn't depend on a deadline the client hasn't chosen yet
 *   See: contracts/api/src/instruction.rs, contracts/program/src/{create,accept}.rs
 *
 *   Pros: client commits to a deadline they chose — no "I never agreed to that"
 *   Cons: two-step UX; teacher can't plan around a specific date upfront;
 *         contract changes required for on-chain enforcement
 *
 * TEACHER-SETS-DEADLINE (commented out — search "TEACHER-SETS-DEADLINE"):
 *   Provider fills in a deadline here. PDA seeded with (provider, deadline_bytes).
 *   Student just accepts the fixed terms with no deadline of their own.
 *   Swap the labelled blocks below to revert to this mode.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { getPublicKey } from "../services/wallet.js";
import { createEscrow } from "../services/transactions.js";
import { datetimeLocalToUnix, defaultDeadline } from "../utils/format.js"; // datetimeLocalToUnix used in teacher-sets-deadline mode
import { toast } from "./toast-manager.js";
import { NETWORK } from "../config.js";

class CreateModal extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  _render() {
    this.innerHTML = `
      <div class="modal-overlay" id="create-overlay">
        <div class="modal" role="dialog" aria-modal="true">

          <div class="modal__header">
            <h2 class="modal__title">New Escrow</h2>
            <button class="modal__close" id="modal-close">✕</button>
          </div>

          <div id="modal-form-section" style="padding:20px;">

            <!-- STUDENT-SETS-DEADLINE (active): no deadline input for teacher. -->
            <p class="form-hint" style="margin-bottom:16px">
              The client will set their own deadline when they accept.
            </p>

            <!--
              TEACHER-SETS-DEADLINE (commented out):
              Restore this block and remove the paragraph above to let the teacher
              set the deadline instead. Also update _submit() and open() below.

              <div class="form-group">
                <label class="form-label" for="deadline-input">Deadline</label>
                <input class="form-input" type="datetime-local"
                  id="deadline-input" value="${defaultDeadline(7)}" />
                <span class="form-hint">
                  Student must complete their commitment before this date.
                </span>
              </div>
            -->

            <div class="form-actions">
              <button class="btn btn--ghost" id="modal-cancel-btn">Cancel</button>
              <button class="btn btn--primary" id="modal-submit-btn">
                <span id="submit-label">Create Escrow</span>
              </button>
            </div>
          </div>

          <div id="share-section" hidden style="padding:20px;">
            <p style="font-size:12px;color:var(--text-muted);line-height:1.6;margin-bottom:4px;">
              Escrow created. Send this link to your client.
            </p>
            <div class="share-box">
              <div class="share-box__label">Client Link</div>
              <div class="share-box__url" id="share-url"></div>
              <button class="share-box__copy" id="share-copy-btn">Copy Link</button>
            </div>
            <div class="form-actions">
              <button class="btn btn--primary" id="done-btn">Done</button>
            </div>
          </div>

        </div>
      </div>
    `;

    this._overlay = this.querySelector("#create-overlay");
    this.querySelector("#modal-close").addEventListener("click", () =>
      this.close(),
    );
    this.querySelector("#modal-cancel-btn").addEventListener("click", () =>
      this.close(),
    );
    this.querySelector("#done-btn").addEventListener("click", () =>
      this.close(),
    );
    this._overlay.addEventListener("click", (e) => {
      if (e.target === this._overlay) this.close();
    });
    this.querySelector("#modal-submit-btn").addEventListener("click", () =>
      this._submit(),
    );
    this.querySelector("#share-copy-btn").addEventListener("click", () => {
      const url = this.querySelector("#share-url").textContent;
      navigator.clipboard.writeText(url).catch(() => {});
      this.querySelector("#share-copy-btn").textContent = "Copied!";
    });
  }

  open() {
    this._showForm();
    this._overlay.classList.add("is-open");

    // STUDENT-SETS-DEADLINE (active): no deadline input to reset.

    // TEACHER-SETS-DEADLINE (commented out): reset the deadline input.
    // this.querySelector("#deadline-input").value = defaultDeadline(7);
  }

  close() {
    this._overlay.classList.remove("is-open");
  }

  _showForm() {
    this.querySelector("#modal-form-section").hidden = false;
    this.querySelector("#share-section").hidden = true;
    this.querySelector("#modal-submit-btn").disabled = false;
    this.querySelector("#submit-label").textContent = "Create Escrow";
  }

  _showShare(pda) {
    this.querySelector("#modal-form-section").hidden = true;
    this.querySelector("#share-section").hidden = false;
    this.querySelector("#share-url").textContent =
      location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html?escrow=" + pda;
  }

  async _submit() {
    const providerPubkey = getPublicKey();
    if (!providerPubkey) {
      toast.error("Wallet not connected");
      return;
    }

    // ── DEADLINE RESOLUTION ──────────────────────────────────────────────────────
    //
    // STUDENT-SETS-DEADLINE (active):
    //   Use a ~10-year far-future sentinel so the on-chain Create instruction
    //   (which requires deadline > now) still accepts the transaction.
    //   The client will pick the real commitment deadline on the accept page.
    //   TODO (contract): once Create no longer requires a meaningful deadline and
    //   the PDA seed is changed to a nonce, remove this sentinel.
    //
    const deadline = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60;

    // ── TEACHER-SETS-DEADLINE (commented out): teacher explicitly picks deadline.
    // const deadlineInput = this.querySelector("#deadline-input").value;
    // if (!deadlineInput) { toast.error("Please set a deadline"); return; }
    // const deadline = datetimeLocalToUnix(deadlineInput);
    // if (deadline <= Math.floor(Date.now() / 1000)) {
    //   toast.error("Deadline must be in the future"); return;
    // }
    // ─────────────────────────────────────────────────────────────────────────────

    const submitBtn = this.querySelector("#modal-submit-btn");
    submitBtn.disabled = true;
    this.querySelector("#submit-label").textContent = "Creating...";

    try {
      const { signature, pda } = await createEscrow(providerPubkey, deadline);
      window.dispatchEvent(
        new CustomEvent("escrow:created", {
          detail: { pda, deadline, signature },
        }),
      );
      toast.success("Escrow created", pda.slice(0, 8) + "...");
      this._showShare(pda);
    } catch (err) {
      console.error("[create-modal]", err);
      toast.error("Transaction failed", err.message ?? String(err));
      submitBtn.disabled = false;
      this.querySelector("#submit-label").textContent = "Create Escrow";
    }
  }
}

customElements.define("create-modal", CreateModal);
