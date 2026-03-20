/**
 * fund.js — mint cfUSDC and cfUSDT to the id wallet and an optional student wallet.
 *
 * Usage:
 *   node fund.js                          # funds only the id wallet
 *   node fund.js <student-pubkey>         # funds id wallet + student wallet
 *   node fund.js <student-pubkey> <amt>   # custom amount per token (default: 10000)
 *
 * Examples:
 *   node fund.js
 *   node fund.js Bg8h6gUJPbmMA1kjamJURThJ7chTAqsQjQ7im2CyZYgv
 *   node fund.js Bg8h6gUJPbmMA1kjamJURThJ7chTAqsQjQ7im2CyZYgv 5000
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
const DEFAULT_AMOUNT = 10_000; // 10,000 tokens per mint

function loadKeypair(path) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")))
  );
}

function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function buildMintIx(authority, recipient, useUsdc, amount) {
  const mintSeed = useUsdc ? CFUSDC_SEED : CFUSDT_SEED;
  const mint = pda([mintSeed]);
  const mintAuthority = pda([MINT_AUTHORITY_SEED]);
  const config = pda([CONFIG_SEED]);
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient);

  const data = Buffer.alloc(17);
  data.writeUInt8(1, 0);                          // MintTo discriminator
  data.writeBigUInt64LE(amount, 1);               // amount
  data.writeUInt8(useUsdc ? 1 : 0, 9);           // use_usdc flag

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey,         isSigner: true,  isWritable: true  },
      { pubkey: config,                      isSigner: false, isWritable: false },
      { pubkey: mint,                        isSigner: false, isWritable: true  },
      { pubkey: mintAuthority,               isSigner: false, isWritable: false },
      { pubkey: recipient,                   isSigner: false, isWritable: false },
      { pubkey: recipientAta,                isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function mintBoth(connection, authority, recipient, rawAmount, label) {
  console.log(`\nFunding ${label} (${recipient.toBase58()})…`);

  // cfUSDC
  const usdcTx = new Transaction().add(buildMintIx(authority, recipient, true, rawAmount));
  const usdcSig = await sendAndConfirmTransaction(connection, usdcTx, [authority]);
  console.log(`  cfUSDC tx: ${usdcSig}`);

  // cfUSDT
  const usdtTx = new Transaction().add(buildMintIx(authority, recipient, false, rawAmount));
  const usdtSig = await sendAndConfirmTransaction(connection, usdtTx, [authority]);
  console.log(`  cfUSDT tx: ${usdtSig}`);
}

async function main() {
  const [, , studentArg, amountArg] = process.argv;

  const humanAmount = amountArg ? parseFloat(amountArg) : DEFAULT_AMOUNT;
  const rawAmount   = BigInt(Math.round(humanAmount * 10 ** DECIMALS));

  const authority  = loadKeypair(`${homedir()}/.config/solana/id.json`);
  const connection = new Connection(RPC, "confirmed");

  console.log(`Authority (id wallet): ${authority.publicKey.toBase58()}`);
  console.log(`Mint amount: ${humanAmount} per token`);

  // Always fund the id wallet itself
  await mintBoth(connection, authority, authority.publicKey, rawAmount, "id wallet");

  // Fund the student wallet if provided
  if (studentArg) {
    let studentPubkey;
    try {
      studentPubkey = new PublicKey(studentArg);
    } catch {
      console.error(`Invalid student pubkey: ${studentArg}`);
      process.exit(1);
    }
    await mintBoth(connection, authority, studentPubkey, rawAmount, "student wallet");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
