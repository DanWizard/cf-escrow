/**
 * initialize.js — creates cfUSDC and cfUSDT mints on devnet.
 * Run once after deploying the program.
 *
 * Usage: node initialize.js
 *
 * After running, copy the printed mint addresses into:
 *   frontend/js/config.js  (USDC_MINT / USDT_MINT)
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
import { readFileSync } from "fs";
import { homedir } from "os";

// ── update this after running deploy.sh ──────────────────────────────────────
const PROGRAM_ID = new PublicKey("C3YBZVUriPRKb9RtDLrjVW4tvsN85gi9KQ7x2usx1xoF");
// ─────────────────────────────────────────────────────────────────────────────

const RPC = "https://api.devnet.solana.com";
const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSVAR_RENT = new PublicKey("SysvarRent111111111111111111111111111111111");

const CONFIG_SEED         = Buffer.from("config");
const MINT_AUTHORITY_SEED = Buffer.from("mint_authority");
const CFUSDC_SEED         = Buffer.from("cfUSDC");
const CFUSDT_SEED         = Buffer.from("cfUSDT");

function loadKeypair(path) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")))
  );
}

function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

async function main() {
  const payer = loadKeypair(`${homedir()}/.config/solana/id.json`);
  const connection = new Connection(RPC, "confirmed");

  const config        = pda([CONFIG_SEED]);
  const mintAuthority = pda([MINT_AUTHORITY_SEED]);
  const cfusdcMint    = pda([CFUSDC_SEED]);
  const cfusdtMint    = pda([CFUSDT_SEED]);

  console.log("Payer:          ", payer.publicKey.toBase58());
  console.log("Config PDA:     ", config.toBase58());
  console.log("Mint authority: ", mintAuthority.toBase58());
  console.log("cfUSDC mint:    ", cfusdcMint.toBase58());
  console.log("cfUSDT mint:    ", cfusdtMint.toBase58());
  console.log();

  // Check if already initialized
  const configAccount = await connection.getAccountInfo(config);
  if (configAccount !== null) {
    console.log("Already initialized!");
    return;
  }

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey,  isSigner: true,  isWritable: true  }, // payer
      { pubkey: config,           isSigner: false, isWritable: true  }, // config PDA
      { pubkey: cfusdcMint,       isSigner: false, isWritable: true  }, // cfUSDC mint PDA
      { pubkey: cfusdtMint,       isSigner: false, isWritable: true  }, // cfUSDT mint PDA
      { pubkey: mintAuthority,    isSigner: false, isWritable: false }, // mint authority PDA
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT,      isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0]), // Initialize discriminator
  });

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer],
  );

  console.log("Tx:", sig);
  console.log();
  console.log("─── copy these mint addresses ───────────────────────────────");
  console.log(`cfUSDC: ${cfusdcMint.toBase58()}`);
  console.log(`cfUSDT: ${cfusdtMint.toBase58()}`);
  console.log();
  console.log("Update frontend/js/config.js with the mint addresses above.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
