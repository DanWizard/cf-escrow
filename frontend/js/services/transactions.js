/**
 * transactions.js
 * Builds and sends program instructions via the connected wallet.
 */

import { PROGRAM_ID, DEFAULT_PUBKEY } from "../config.js";
import { signAndSend } from "./wallet.js";
import { getConnection } from "./chain.js";
import {
  deadlineToBytes,
  serializeCreate,
  serializeCancel,
  serializeClaimTaskSuccess,
  serializeClaimTaskFailure,
} from "../utils/serialize.js";

// Defer solanaWeb3 access to runtime.
function web3() {
  return window.solanaWeb3;
}

const SPL_TOKEN    = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM  = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function deriveAta(walletPubkey, mintPubkey) {
  const { PublicKey } = web3();
  return PublicKey.findProgramAddressSync(
    [walletPubkey.toBytes(), new PublicKey(SPL_TOKEN).toBytes(), mintPubkey.toBytes()],
    new PublicKey(ATA_PROGRAM),
  )[0];
}

// ── PDA derivation ───────────────────────────────────────────────────────────

export function deriveEscrowPda(providerPubkey, deadline) {
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

// ── Instruction builders ─────────────────────────────────────────────────────

function buildCreateIx(providerPubkey, deadline) {
  const { PublicKey, TransactionInstruction, SystemProgram } = web3();
  const escrowPda = deriveEscrowPda(providerPubkey, deadline);
  return new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      {
        pubkey: new PublicKey(providerPubkey),
        isSigner: true,
        isWritable: true,
      },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: serializeCreate(deadline),
  });
}

function buildCancelIx(providerPubkey, deadline) {
  const { PublicKey, TransactionInstruction } = web3();
  const escrowPda = deriveEscrowPda(providerPubkey, deadline);
  return new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      {
        pubkey: new PublicKey(providerPubkey),
        isSigner: true,
        isWritable: true,
      },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
    ],
    data: serializeCancel(),
  });
}

function buildClaimSuccessIx(teacherPubkey, studentPubkey, deadline, mintStr) {
  const { PublicKey, TransactionInstruction, SystemProgram } = web3();
  const escrowPda = deriveEscrowPda(teacherPubkey, deadline);
  const teacher = new PublicKey(teacherPubkey);
  const student = new PublicKey(studentPubkey);

  const isToken = mintStr && mintStr !== DEFAULT_PUBKEY;
  if (isToken) {
    // Token path (8 accounts): [teacher, student, escrowPda, mint, studentAta, escrowAta, tokenProg, sysProg]
    const mint = new PublicKey(mintStr);
    return new TransactionInstruction({
      programId: new PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: teacher,                            isSigner: true,  isWritable: true  },
        { pubkey: student,                            isSigner: false, isWritable: true  },
        { pubkey: escrowPda,                          isSigner: false, isWritable: true  },
        { pubkey: mint,                               isSigner: false, isWritable: false },
        { pubkey: deriveAta(student, mint),           isSigner: false, isWritable: true  },
        { pubkey: deriveAta(escrowPda, mint),         isSigner: false, isWritable: true  },
        { pubkey: new PublicKey(SPL_TOKEN),           isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId,            isSigner: false, isWritable: false },
      ],
      data: serializeClaimTaskSuccess(),
    });
  }

  // SOL path (4 accounts)
  return new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      { pubkey: teacher,                isSigner: true,  isWritable: true  },
      { pubkey: student,                isSigner: false, isWritable: true  },
      { pubkey: escrowPda,              isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: serializeClaimTaskSuccess(),
  });
}

function buildClaimFailureIx(teacherPubkey, deadline, mintStr) {
  const { PublicKey, TransactionInstruction, SystemProgram } = web3();
  const escrowPda = deriveEscrowPda(teacherPubkey, deadline);
  const teacher = new PublicKey(teacherPubkey);

  const isToken = mintStr && mintStr !== DEFAULT_PUBKEY;
  if (isToken) {
    // Token path (8 accounts): [teacher, teacherAta, escrowPda, mint, escrowAta, tokenProg, ataProg, sysProg]
    const mint = new PublicKey(mintStr);
    return new TransactionInstruction({
      programId: new PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: teacher,                            isSigner: true,  isWritable: true  },
        { pubkey: deriveAta(teacher, mint),           isSigner: false, isWritable: true  },
        { pubkey: escrowPda,                          isSigner: false, isWritable: true  },
        { pubkey: mint,                               isSigner: false, isWritable: false },
        { pubkey: deriveAta(escrowPda, mint),         isSigner: false, isWritable: true  },
        { pubkey: new PublicKey(SPL_TOKEN),           isSigner: false, isWritable: false },
        { pubkey: new PublicKey(ATA_PROGRAM),         isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId,            isSigner: false, isWritable: false },
      ],
      data: serializeClaimTaskFailure(),
    });
  }

  // SOL path (3 accounts)
  return new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [
      { pubkey: teacher,                isSigner: true,  isWritable: true  },
      { pubkey: escrowPda,              isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: serializeClaimTaskFailure(),
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function createEscrow(providerPubkey, deadline) {
  const { Transaction } = web3();
  const ix = buildCreateIx(providerPubkey, deadline);
  const pda = deriveEscrowPda(providerPubkey, deadline).toBase58();
  const sig = await signAndSend(new Transaction().add(ix), getConnection());
  return { signature: sig, pda };
}

export async function cancelEscrow(providerPubkey, deadline) {
  const { Transaction } = web3();
  const ix = buildCancelIx(providerPubkey, deadline);
  return signAndSend(new Transaction().add(ix), getConnection());
}

export async function claimTaskSuccess(teacherPubkey, studentPubkey, deadline, mintStr) {
  const { Transaction } = web3();
  const ix = buildClaimSuccessIx(teacherPubkey, studentPubkey, deadline, mintStr);
  return signAndSend(new Transaction().add(ix), getConnection());
}

export async function claimTaskFailure(teacherPubkey, deadline, mintStr) {
  const { Transaction } = web3();
  const ix = buildClaimFailureIx(teacherPubkey, deadline, mintStr);
  return signAndSend(new Transaction().add(ix), getConnection());
}
