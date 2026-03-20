/**
 * wallet-header.js
 * <wallet-header> — admin header with wallet dropdown.
 *
 * Dropdown options:
 *   - Switch wallet (connect a different one)
 *   - Disconnect
 */

import {
  connect,
  disconnect,
  getPublicKey,
  isConnected,
} from "../services/wallet.js";
import { truncate } from "../utils/format.js";
import { NETWORK } from "../config.js";
import { toast } from "./toast-manager.js";
import { fetchBalances } from "../services/chain.js";

class WalletHeader extends HTMLElement {
  static get observedAttributes() {
    return ["active-route"];
  }

  attributeChangedCallback() {
    if (this.isConnected) this._render();
  }

  connectedCallback() {
    this._open = false;
    this._balances = null;
    this._render();
    window.addEventListener("wallet:connected", () => {
      this._open = false;
      this._balances = null;
      this._render();
      this._loadBalances();
    });
    window.addEventListener("wallet:disconnected", () => {
      this._open = false;
      this._balances = null;
      this._render();
    });
    document.addEventListener("click", (e) => {
      if (!this.contains(e.target) && this._open) {
        this._open = false;
        this._render();
      }
    });
    // If already connected on mount (auto-connect fired before this element registered)
    if (isConnected()) {
      this._loadBalances();
    }
  }

  async _loadBalances() {
    const pubkey = getPublicKey();
    if (!pubkey) return;
    try {
      this._balances = await fetchBalances(pubkey);
    } catch (err) {
      console.warn("[wallet-header] fetchBalances failed:", err);
      this._balances = { sol: 0, usdc: 0, usdt: 0 };
    }
    this._render();
  }

  _render() {
    const connected = isConnected();
    const pubkey = connected ? getPublicKey() : null;

    const balanceChips =
      connected && this._balances
        ? `<div class="wallet-balances">
          <span class="wallet-balance-chip">${this._balances.sol.toFixed(3)} SOL</span>
          <span class="wallet-balance-chip">${this._balances.usdc.toFixed(2)} USDC</span>
          <span class="wallet-balance-chip">${this._balances.usdt.toFixed(2)} USDT</span>
        </div>`
        : "";

    const activeRoute = this.getAttribute("active-route") || "client";
    const isProviderPage = activeRoute === "provider";
    const isClientPage   = activeRoute === "client";

    this.innerHTML = `
      <header class="header">
        <div class="header__brand">
          <div class="header__logo">CF</div>
          <span class="header__network">${NETWORK}</span>
        </div>

        <nav class="header__nav">
          <a class="header__nav-btn ${isProviderPage ? "header__nav-btn--active" : ""}" data-route="provider">Provider</a>
          <a class="header__nav-btn ${isClientPage ? "header__nav-btn--active" : ""}" data-route="client">Client</a>
        </nav>

        <div class="header__right">
          ${balanceChips}
          <div class="wallet-wrap">
            <button class="wallet-btn ${connected ? "wallet-btn--connected" : ""}" id="wallet-trigger">
              <span class="wallet-btn__dot"></span>
              ${
                connected
                  ? `<span class="wallet-btn__address">${truncate(pubkey)}</span>
                     <span style="font-size:10px;opacity:.5;margin-left:2px;">▾</span>`
                  : "Connect"
              }
            </button>

            ${
              this._open
                ? `<div class="wallet-dropdown">
                    ${
                      connected
                        ? `<button class="wallet-dropdown__item" id="dd-switch">Switch wallet</button>
                           <div class="wallet-dropdown__divider"></div>
                           <button class="wallet-dropdown__item wallet-dropdown__item--danger" id="dd-disconnect">Disconnect</button>`
                        : `<button class="wallet-dropdown__item" id="dd-connect">Connect wallet</button>`
                    }
                  </div>`
                : ""
            }
          </div>
        </div>
      </header>
    `;

    this.querySelector("#wallet-trigger").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!connected) {
        this._connect();
      } else {
        this._open = !this._open;
        this._render();
      }
    });

    if (this._open) {
      this.querySelector("#dd-connect")?.addEventListener("click", () =>
        this._connect(),
      );
      this.querySelector("#dd-switch")?.addEventListener("click", () =>
        this._switchWallet(),
      );
      this.querySelector("#dd-disconnect")?.addEventListener("click", () =>
        this._disconnect(),
      );
    }
  }

  async _connect() {
    this._open = false;
    try {
      await connect();
    } catch (err) {
      toast.error("Connection failed", err.message);
      this._render();
    }
  }

  async _switchWallet() {
    this._open = false;
    // Disconnect current then reconnect — this forces the wallet picker popup
    await disconnect();
    try {
      await connect();
    } catch (err) {
      toast.error("Connection failed", err.message);
      this._render();
    }
  }

  async _disconnect() {
    this._open = false;
    await disconnect();
    toast.info("Disconnected");
  }
}

customElements.define("wallet-header", WalletHeader);
