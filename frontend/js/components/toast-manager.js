/**
 * toast-manager.js
 * <toast-manager> web component.
 *
 * Listens for 'toast' events dispatched on window:
 *   window.dispatchEvent(new CustomEvent('toast', {
 *     detail: { type: 'success'|'error'|'info', title: string, message?: string }
 *   }))
 *
 * Convenience helper:
 *   import { toast } from './toast-manager.js';
 *   toast.success('Title', 'Optional message');
 */

const AUTO_DISMISS_MS = 5000;

class ToastManager extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `<div class="toast-container" id="toast-container"></div>`;
    this._container = this.querySelector("#toast-container");

    window.addEventListener("toast", (e) => this._show(e.detail));
  }

  _show({ type = "info", title, message }) {
    const icons = { success: "✓", error: "✕", info: "ℹ" };

    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.innerHTML = `
      <span class="toast__icon">${icons[type] ?? icons.info}</span>
      <div class="toast__body">
        <div class="toast__title">${title}</div>
        ${message ? `<div class="toast__msg">${message}</div>` : ""}
      </div>
    `;

    this._container.appendChild(el);

    // Auto-dismiss
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 300ms ease";
      setTimeout(() => el.remove(), 320);
    }, AUTO_DISMISS_MS);
  }
}

customElements.define("toast-manager", ToastManager);

/** Convenience helpers for dispatching toast events. */
export const toast = {
  success: (title, message) =>
    window.dispatchEvent(
      new CustomEvent("toast", { detail: { type: "success", title, message } }),
    ),
  error: (title, message) =>
    window.dispatchEvent(
      new CustomEvent("toast", { detail: { type: "error", title, message } }),
    ),
  info: (title, message) =>
    window.dispatchEvent(
      new CustomEvent("toast", { detail: { type: "info", title, message } }),
    ),
};
