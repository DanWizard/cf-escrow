/**
 * config.js
 * Central configuration. Update PROGRAM_ID and TEST_TOKENS_PROGRAM_ID after each deploy.
 */

export const PROGRAM_ID = "pVdMMWMsvHDGjdzXwHPTCBR2HqfrWxqqFSN4XeR3qLJ";
export const RPC_URL = "https://api.devnet.solana.com";
export const NETWORK = "devnet";

export const DEFAULT_PUBKEY = "11111111111111111111111111111111";

/**
 * Test-tokens program (devnet).
 * Update this after running `cd test-tokens && ./deploy.sh`, then re-derive the mints below.
 * The cfUSDC and cfUSDT mint addresses are PDAs derived from this program ID —
 * they update automatically when TEST_TOKENS_PROGRAM_ID changes.
 *
 * To mint tokens to a wallet:
 *   cd test-tokens/scripts && node fund.js <wallet-pubkey>
 */
export const TEST_TOKENS_PROGRAM_ID =
  "C3YBZVUriPRKb9RtDLrjVW4tvsN85gi9KQ7x2usx1xoF";

// Derive the cfUSDC and cfUSDT PDA mints from the test-tokens program.
// window.solanaWeb3 is available here because the web3 <script> tag loads synchronously
// before any type="module" scripts run.
const _testPid = new window.solanaWeb3.PublicKey(TEST_TOKENS_PROGRAM_ID);
const _enc = new TextEncoder();
export const USDC_MINT = window.solanaWeb3.PublicKey.findProgramAddressSync(
  [_enc.encode("cfUSDC")],
  _testPid,
)[0].toBase58();
export const USDT_MINT = window.solanaWeb3.PublicKey.findProgramAddressSync(
  [_enc.encode("cfUSDT")],
  _testPid,
)[0].toBase58();

/**
 * Mainnet token mints (used when NETWORK === "mainnet-beta").
 */
export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MAINNET_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const ESCROW_ACCOUNT_SIZE = 128;
export const RECLAIM_GRACE_SECONDS = 7 * 24 * 60 * 60;

export const IX = {
  Create: 0,
  Cancel: 1,
  Accept: 2,
  ClaimTaskFailure: 3,
  ClaimTaskSuccess: 4,
  Reclaim: 5,
};

/** localStorage key for persisting wallet pubkey across refreshes */
export const WALLET_STORAGE_KEY = "cf-escrow:wallet";
