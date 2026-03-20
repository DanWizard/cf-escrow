/**
 * escrow-list.js
 * <escrow-list> web component.
 *
 * Manages the list of all teacher escrows (live + closed).
 * Public methods:
 *   .setLoading(bool)
 *   .setEscrows(escrows[])  — renders cards, sorted by deadline desc
 */

class EscrowList extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `<div class="escrow-list"></div>`;
    this._list = this.querySelector(".escrow-list");
  }

  /** Show or hide a loading spinner. */
  setLoading(loading) {
    if (!this._list) return;
    if (loading) {
      this._list.innerHTML = `
        <div class="escrow-list__loading">
          <div class="spinner"></div>
          Fetching escrows…
        </div>
      `;
    }
  }

  /**
   * Render all escrows.
   * @param {Array<{state:string, ...}>} escrows
   */
  setEscrows(escrows) {
    if (!this._list) return;

    if (!escrows.length) {
      this._list.innerHTML = `
        <div class="escrow-list__empty">
          <strong>No escrows yet</strong>
          Click "New Escrow" to create your first commitment contract.
        </div>
      `;
      return;
    }

    // Sort: active first (unaccepted, accepted, overdue), then closed
    const ORDER = {
      unaccepted: 0,
      accepted: 1,
      accepted_overdue: 2,
      succeeded: 3,
      failed: 4,
      reclaimed: 5,
      cancelled: 6,
      closed: 7,
    };

    const sorted = [...escrows].sort((a, b) => {
      const stateOrder = (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9);
      if (stateOrder !== 0) return stateOrder;
      return (b.deadline ?? 0) - (a.deadline ?? 0); // newest deadline first within group
    });

    this._list.innerHTML = "";
    for (const escrow of sorted) {
      const card = document.createElement("escrow-card");
      card.escrow = escrow;
      this._list.appendChild(card);
    }
  }
}

customElements.define("escrow-list", EscrowList);
