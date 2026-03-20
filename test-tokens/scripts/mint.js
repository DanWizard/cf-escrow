/**
 * mint.js — mint cfUSDC or cfUSDT to any wallet.
 * Only the id wallet (the deploy authority) can call this.
 *
 * Usage:
 *   node mint.js <recipient>  <amount>  [usdc|usdt]
 *
 * Examples:
 *   node mint.js Bg8h6gUJPbmMA1kjamJURThJ7chTAqsQjQ7im2CyZYgv 1000 usdc
 *   node mint.js khnE2hkjCZkguzVW6k3tDSSjAYzB23iogwtigGogjvM  500  usdt
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "fs";
import { homedir } from "os";

// ── update this after running deploy.sh ──────────────────────────────────────
const PROGRAM_ID = new PublicKey("C3YBZVUriPRKb9RtDLrjVW4tvsN85gi9KQ7x2usx1xoF");
// ─────────────────────────────────────────────────────────────────────────────

const RPC = "https://api.devnet.solana.com";

const CONFIG_SEED         = Buffer.from("config");
const MINT_AUTHORITY_SEED = Buffer.from("mint_authority");
const CFUSDC_SEED         = Buffer.from("cfUSDC");
const CFUSDT_SEED         = Buffer.from("cfUSDT");

const DECIMALS = 6;

function loadKeypair(path) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")))
  );
}

function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

async function main() {
  const [, , recipientArg, amountArg, tokenArg = "usdc"] = process.argv;

  if (!recipientArg || !amountArg) {
    console.error("Usage: node mint.js <recipient> <amount> [usdc|usdt]");
    process.exit(1);
  }

  const useUsdc   = tokenArg.toLowerCase() !== "usdt";
  const recipient = new PublicKey(recipientArg);
  const amount    = BigInt(Math.round(parseFloat(amountArg) * 10 ** DECIMALS));

  const authority     = loadKeypair(`${homedir()}/.config/solana/id.json`);
  const connection    = new Connection(RPC, "confirmed");

  const config        = pda([CONFIG_SEED]);
  const mintAuthority = pda([MINT_AUTHORITY_SEED]);
  const mint          = pda([useUsdc ? CFUSDC_SEED : CFUSDT_SEED]);
  const recipientAta  = getAssociatedTokenAddressSync(mint, recipient);

  console.log(`Minting ${amountArg} ${useUsdc ? "cfUSDC" : "cfUSDT"} → ${recipient.toBase58()}`);
  console.log(`ATA: ${recipientAta.toBase58()}`);

  // MintTo instruction data layout (16 bytes, prefixed by 1-byte discriminator):
  //   [0]    u8   : discriminator = 1 (MintTo)
  //   [1..8] u64  : amount (little-endian)
  //   [9]    u8   : use_usdc  (1 = cfUSDC, 0 = cfUSDT)
  //   [10..16]    : padding (zeros)
  const data = Buffer.alloc(17);
  data.writeUInt8(1, 0);                          // MintTo discriminator
  data.writeBigUInt64LE(amount, 1);               // amount
  data.writeUInt8(useUsdc ? 1 : 0, 9);           // use_usdc
  // bytes 10-16 stay zero (padding)

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey,       isSigner: true,  isWritable: true  }, // authority
      { pubkey: config,                    isSigner: false, isWritable: false }, // config
      { pubkey: mint,                      isSigner: false, isWritable: true  }, // mint
      { pubkey: mintAuthority,             isSigner: false, isWritable: false }, // mint authority PDA
      { pubkey: recipient,                 isSigner: false, isWritable: false }, // recipient wallet
      { pubkey: recipientAta,              isSigner: false, isWritable: true  }, // recipient ATA
      { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
    ],
    data,
  });

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [authority],
  );

  console.log("Tx:", sig);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
