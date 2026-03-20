/**
 * chain.js
 * Fetches and parses escrow accounts from the Solana blockchain.
 *
 * Escrow layout (128 bytes):
 *   [0..8]    discriminator
 *   [8..40]   provider  Pubkey
 *   [40..72]  client    Pubkey
 *   [72..104] mint      Pubkey
 *   [104..112] amount   u64 LE
 *   [112..120] deadline i64 LE
 *   [120..128] bump     u64 LE
 */

import {
  PROGRAM_ID,
  RPC_URL,
  DEFAULT_PUBKEY,
  ESCROW_ACCOUNT_SIZE,
  IX,
  NETWORK,
  USDC_MINT,
  USDT_MINT,
  MAINNET_USDC_MINT,
  MAINNET_USDT_MINT,
} from "../config.js";

// Defer solanaWeb3 access until runtime so the IIFE is guaranteed loaded.
function web3() {
  return window.solanaWeb3;
}

/** Shared RPC connection — created lazily on first use. */
let _connection = null;
export function getConnection() {
  if (!_connection) {
    _connection = new (web3().Connection)(RPC_URL, "confirmed");
  }
  return _connection;
}
// Named export alias kept for backwards compat with existing imports.
export const connection = { get: getConnection };

// ── Parsing helpers ──────────────────────────────────────────────────────────

function readPubkey(data, offset) {
  return new (web3().PublicKey)(data.slice(offset, offset + 32)).toBase58();
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
    client: readPubkey(data, 40),
    mint: readPubkey(data, 72),
    amount: readU64(view, 104),
    deadline: readI64(view, 112),
    bump: readU64(view, 120),
  };
}

// ── State ────────────────────────────────────────────────────────────────────

export function computeState(escrow) {
  const now = Math.floor(Date.now() / 1000);
  const clientIsEmpty = escrow.client === DEFAULT_PUBKEY;
  if (clientIsEmpty) return "unaccepted";
  return now > escrow.deadline ? "accepted_overdue" : "accepted";
}

// ── Fetching ─────────────────────────────────────────────────────────────────

export async function fetchLiveEscrows(providerPubkey) {
  const conn = getConnection();
  const programId = new (web3().PublicKey)(PROGRAM_ID);

  const accounts = await conn.getProgramAccounts(programId, {
    filters: [
      { dataSize: ESCROW_ACCOUNT_SIZE },
      { memcmp: { offset: 8, bytes: providerPubkey } },
    ],
  });

  return accounts
    .map(({ pubkey, account }) => parseEscrow(pubkey.toBase58(), account.data))
    .filter(Boolean);
}

export async function fetchClosedState(pdaPubkey) {
  try {
    const conn = getConnection();
    const sigs = await conn.getSignaturesForAddress(
      new (web3().PublicKey)(pdaPubkey),
      { limit: 1 },
      "confirmed",
    );
    if (!sigs.length) return "unknown";

    const tx = await conn.getParsedTransaction(sigs[0].signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return "unknown";

    const ixs = tx.transaction.message.instructions ?? [];
    for (const ix of ixs) {
      const prog = ix.programId?.toBase58?.() ?? ix.programId;
      if (prog !== PROGRAM_ID) continue;
      if (!ix.data) continue;
      const decoded = decodeBase58(ix.data);
      const discriminator = decoded[0];
      switch (discriminator) {
        case IX.Cancel:
          return "cancelled";
        case IX.ClaimTaskFailure:
          return "failed";
        case IX.ClaimTaskSuccess:
          return "succeeded";
        case IX.Reclaim:
          return "reclaimed";
      }
    }
  } catch (err) {
    console.warn("[chain] fetchClosedState:", err);
  }
  return "unknown";
}

// ── Base58 decoder (minimal) ─────────────────────────────────────────────────

function decodeBase58(str) {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = [];
  let zeros = 0;
  for (const ch of str) {
    let carry = ALPHA.indexOf(ch);
    if (carry < 0) throw new Error("Bad base58 char: " + ch);
    for (let i = result.length - 1; i >= 0; i--) {
      carry += result[i] * 58;
      result[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      result.unshift(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch === "1") zeros++;
    else break;
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...result]);
}

/**
 * Fetch SOL, USDC, and USDT balances for a wallet pubkey.
 * Uses devnet cfUSDC/cfUSDT mints on devnet, real mints on mainnet-beta.
 * Returns { sol, usdc, usdt } as human-readable numbers (not raw).
 */
export async function fetchBalances(pubkeyStr) {
  const conn = getConnection();
  const W3 = web3();
  const pubkey = new W3.PublicKey(pubkeyStr);
  const SPL_TOKEN = new W3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  const usdcMint = NETWORK === "mainnet-beta" ? MAINNET_USDC_MINT : USDC_MINT;
  const usdtMint = NETWORK === "mainnet-beta" ? MAINNET_USDT_MINT : USDT_MINT;

  const [lamports, tokenAccounts] = await Promise.all([
    conn.getBalance(pubkey),
    conn.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_TOKEN }),
  ]);

  let usdc = 0;
  let usdt = 0;
  for (const { account } of tokenAccounts.value) {
    const info = account.data.parsed.info;
    if (info.mint === usdcMint) usdc = parseFloat(info.tokenAmount.uiAmountString ?? "0");
    if (info.mint === usdtMint) usdt = parseFloat(info.tokenAmount.uiAmountString ?? "0");
  }

  return { sol: lamports / 1_000_000_000, usdc, usdt };
}

/**
 * Fetch a single escrow account by its PDA address.
 * Returns the parsed Escrow object or null if not found.
 */
export async function fetchEscrowByPda(pdaPubkey) {
  const conn = getConnection();
  const account = await conn.getAccountInfo(new (web3().PublicKey)(pdaPubkey));
  if (!account) return null;
  return parseEscrow(pdaPubkey, account.data);
}
