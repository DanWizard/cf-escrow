/**
 * format.js
 * Pure display-formatting helpers. No side effects, no imports.
 */

import { DEFAULT_PUBKEY, USDC_MINT, USDT_MINT } from "../config.js";

/**
 * Shorten a base58 public key for display.
 * "Fg6P...LnS"
 */
export function truncate(pubkey, chars = 4) {
  if (!pubkey || pubkey.length < chars * 2) return pubkey ?? "";
  return `${pubkey.slice(0, chars)}…${pubkey.slice(-chars)}`;
}

/**
 * Format a Unix timestamp (seconds) to a human-readable local datetime.
 */
export function formatDeadline(unixSeconds) {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format an amount given the mint address.
 * SOL: lamports → X.XXXX SOL
 * USDC/USDT: raw units → X.XX (6 decimals)
 */
export function formatAmount(rawAmount, mintPubkey) {
  if (!rawAmount && rawAmount !== 0) return "—";

  if (!mintPubkey || mintPubkey === DEFAULT_PUBKEY) {
    const sol = rawAmount / 1_000_000_000;
    return `${sol.toFixed(4)} SOL`;
  }

  if (mintPubkey === USDC_MINT) {
    return `${(rawAmount / 1_000_000).toFixed(2)} USDC`;
  }

  if (mintPubkey === USDT_MINT) {
    return `${(rawAmount / 1_000_000).toFixed(2)} USDT`;
  }

  // Unknown token: show raw with mint label
  return `${rawAmount} (${truncate(mintPubkey)})`;
}

/**
 * Return a human label for an escrow state key.
 */
export function stateLabel(state) {
  const labels = {
    unaccepted: "Pending",
    accepted: "Active",
    accepted_overdue: "Active",
    succeeded: "Completed",
    failed: "Failed",
    reclaimed: "Reclaimed",
    cancelled: "Cancelled",
    closed: "Closed",
  };
  return labels[state] ?? state;
}

/**
 * Return the CSS modifier class for a badge given an escrow state.
 */
export function stateBadgeClass(state) {
  const map = {
    unaccepted: "unaccepted",
    accepted: "accepted",
    accepted_overdue: "overdue",
    succeeded: "succeeded",
    failed: "failed",
    reclaimed: "reclaimed",
    cancelled: "cancelled",
    closed: "closed",
  };
  return map[state] ?? "closed";
}

/**
 * Convert a datetime-local input value (e.g. "2025-06-01T15:00")
 * to a Unix timestamp in seconds.
 */
export function datetimeLocalToUnix(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

/**
 * Return a datetime-local string for `now + offsetMinutes`.
 * Useful for pre-filling deadline inputs.
 */
export function defaultDeadline(offsetDays = 7) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  // Format as "YYYY-MM-DDTHH:MM" for datetime-local input
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
