/**
 * wallet.js
 * Wallet connection with localStorage persistence and dropdown support.
 *
 * Emits on window:
 *   wallet:connected    { detail: { publicKey: string } }
 *   wallet:disconnected {}
 */

import { WALLET_STORAGE_KEY } from "../config.js";

let _provider = null;
let _publicKey = null;

function getProvider() {
  try { if (window.backpack?.solana) return window.backpack.solana; } catch {}
  try { if (window.phantom?.solana) return window.phantom.solana; } catch {}
  try { if (window.solana?.isSolana || window.solana?.isPhantom) return window.solana; } catch {}
  return null;
}

export function getPublicKey() {
  return _publicKey ? _publicKey.toBase58() : null;
}

export function isConnected() {
  return _publicKey !== null;
}

export async function connect() {
  const provider = getProvider();
  if (!provider) {
    throw new Error("No Solana wallet found. Install Phantom or Backpack.");
  }
  const resp = await provider.connect();
  _provider = provider;
  _publicKey = resp.publicKey;

  // Persist pubkey so we can show it on refresh before wallet reconnects
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, _publicKey.toBase58());
  } catch {}

  _listenForDisconnect();
  window.dispatchEvent(
    new CustomEvent("wallet:connected", {
      detail: { publicKey: _publicKey.toBase58() },
    }),
  );
  return _publicKey.toBase58();
}

export async function disconnect() {
  if (_provider) {
    try {
      await _provider.disconnect();
    } catch {}
  }
  _provider = null;
  _publicKey = null;
  try {
    localStorage.removeItem(WALLET_STORAGE_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent("wallet:disconnected"));
}

export async function signAndSend(transaction, connection) {
  if (!_provider || !_publicKey) throw new Error("Wallet not connected");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = _publicKey;
  const signed = await _provider.signTransaction(transaction);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Eagerly reconnect if wallet was previously trusted.
 * On success fires wallet:connected without a popup.
 * Falls back gracefully if wallet is locked or not trusted.
 */
export async function tryAutoConnect() {
  const provider = getProvider();
  if (!provider) return false;
  try {
    const resp = await provider.connect({ onlyIfTrusted: true });
    _provider = provider;
    _publicKey = resp.publicKey;
    try {
      localStorage.setItem(WALLET_STORAGE_KEY, _publicKey.toBase58());
    } catch {}
    _listenForDisconnect();
    window.dispatchEvent(
      new CustomEvent("wallet:connected", {
        detail: { publicKey: _publicKey.toBase58() },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the pubkey from localStorage if we have one (even before wallet reconnects).
 * Useful for showing a cached address during page load.
 */
export function getCachedPublicKey() {
  try {
    return localStorage.getItem(WALLET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function _listenForDisconnect() {
  if (!_provider?.on) return;
  _provider.on("disconnect", () => {
    _provider = null;
    _publicKey = null;
    try {
      localStorage.removeItem(WALLET_STORAGE_KEY);
    } catch {}
    window.dispatchEvent(new CustomEvent("wallet:disconnected"));
  });
  _provider.on("accountChanged", (newKey) => {
    if (newKey) {
      _publicKey = newKey;
      try {
        localStorage.setItem(WALLET_STORAGE_KEY, _publicKey.toBase58());
      } catch {}
      window.dispatchEvent(
        new CustomEvent("wallet:connected", {
          detail: { publicKey: _publicKey.toBase58() },
        }),
      );
    } else {
      // Wallet locked or account removed — treat as disconnect
      _provider = null;
      _publicKey = null;
      try {
        localStorage.removeItem(WALLET_STORAGE_KEY);
      } catch {}
      window.dispatchEvent(new CustomEvent("wallet:disconnected"));
    }
  });
}
