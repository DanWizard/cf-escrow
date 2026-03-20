/**
 * client-transactions.js
 * Builds and sends Accept instructions for the client.
 * Mirrors accept_sol / accept_token from api/src/sdk.rs.
 */

import { PROGRAM_ID, USDC_MINT, USDT_MINT } from "../config.js";
import { signAndSend } from "./wallet.js";
import { getConnection } from "./chain.js";
import { deadlineToBytes } from "../utils/serialize.js";

function web3() {
  return window.solanaWeb3;
}

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Accept { amount: u64, mint: Pubkey, deadline: i64 }
 *   → [0x02, u64_le(amount), pubkey_bytes(mint), i64_le(deadline)]
 */
function serializeAccept(amountLamports, mintPubkeyBytes, deadlineSeconds) {
  const buf = new ArrayBuffer(1 + 8 + 32 + 8);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);

  // discriminator
  view.setUint8(0, 2);

  // amount as u64 LE
  const amt = BigInt(amountLamports);
  view.setUint32(1, Number(amt & 0xffffffffn), true);
  view.setUint32(5, Number((amt >> 32n) & 0xffffffffn), true);

  // mint pubkey (32 bytes)
  arr.set(mintPubkeyBytes, 9);

  // deadline as i64 LE
  const dl = BigInt(deadlineSeconds);
  view.setUint32(41, Number(dl & 0xffffffffn), true);
  view.setInt32(45, Number((dl >> 32n) & 0xffffffffn), true);

  return arr;
}

// ── PDA derivation ────────────────────────────────────────────────────────────

function deriveEscrowPda(providerPubkey, deadline) {
  const { PublicKey } = web3();
  const [pda] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("escrow"),
      new PublicKey(providerPubkey).toBytes(),
      deadlineToBytes(deadline),
    ],
    new PublicKey(PROGRAM_ID),
  );
  return pda;
}

// ── Accept SOL ────────────────────────────────────────────────────────────────

export async function acceptSol(
  clientPubkey,
  providerPubkey,
  pdaDeadline,
  clientDeadline,
  lamports,
) {
  const { PublicKey, TransactionInstruction, SystemProgram, Transaction } =
    web3();
  const escrowPda = deriveEscrowPda(providerPubkey, pdaDeadline);

  // mint = Pubkey::default() signals SOL path
  const defaultMintBytes = new Uint8Array(32); // all zeros

  const ix = new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      {
        pubkey: new PublicKey(clientPubkey),
        isSigner: true,
        isWritable: true,
      },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: serializeAccept(lamports, defaultMintBytes, clientDeadline),
  });

  return signAndSend(new Transaction().add(ix), getConnection());
}

// ── Accept Token ──────────────────────────────────────────────────────────────

export async function acceptToken(
  clientPubkey,
  providerPubkey,
  pdaDeadline,
  clientDeadline,
  rawAmount,
  mintPubkeyStr,
) {
  const { PublicKey, TransactionInstruction, SystemProgram, Transaction } =
    web3();
  const escrowPda = deriveEscrowPda(providerPubkey, pdaDeadline);
  const mint = new PublicKey(mintPubkeyStr);
  const SPL_TOKEN = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );
  const ATA_PROGRAM = new PublicKey(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  );

  // Derive ATAs
  const [clientAta] = await PublicKey.findProgramAddress(
    [
      new PublicKey(clientPubkey).toBytes(),
      SPL_TOKEN.toBytes(),
      mint.toBytes(),
    ],
    ATA_PROGRAM,
  );
  const [escrowAta] = await PublicKey.findProgramAddress(
    [escrowPda.toBytes(), SPL_TOKEN.toBytes(), mint.toBytes()],
    ATA_PROGRAM,
  );

  const ix = new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      {
        pubkey: new PublicKey(clientPubkey),
        isSigner: true,
        isWritable: true,
      },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: clientAta, isSigner: false, isWritable: true },
      { pubkey: escrowAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: serializeAccept(rawAmount, mint.toBytes(), clientDeadline),
  });

  return signAndSend(new Transaction().add(ix), getConnection());
}
