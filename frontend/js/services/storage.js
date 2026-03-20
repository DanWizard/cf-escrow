/**
 * storage.js
 * Persists escrow metadata in localStorage so the teacher can see
 * closed escrows (failed/succeeded/reclaimed/cancelled) that no
 * longer exist as on-chain accounts.
 *
 * Schema per teacher:
 *   key:   "cf-escrow:v1:<teacherPubkey>"
 *   value: Record<pdaAddress, StoredEscrow>
 *
 * StoredEscrow {
 *   pda:        string   base58 PDA address
 *   deadline:   number   Unix seconds
 *   createdAt:  number   Unix seconds
 *   finalState: string | null   'succeeded'|'failed'|'reclaimed'|'cancelled'|null
 * }
 */

const PREFIX = "cf-escrow:v1:";

function storageKey(teacherPubkey) {
  return `${PREFIX}${teacherPubkey}`;
}

/**
 * Load all stored escrow entries for a teacher.
 * @returns {Record<string, StoredEscrow>}
 */
export function load(teacherPubkey) {
  try {
    const raw = localStorage.getItem(storageKey(teacherPubkey));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save the full record map back to localStorage.
 */
function save(teacherPubkey, record) {
  try {
    localStorage.setItem(storageKey(teacherPubkey), JSON.stringify(record));
  } catch (err) {
    console.warn("[storage] Could not save:", err);
  }
}

/**
 * Register a newly created escrow so we can track it even after it closes.
 */
export function trackEscrow(teacherPubkey, pda, deadline) {
  const record = load(teacherPubkey);
  record[pda] = {
    pda,
    deadline,
    createdAt: Math.floor(Date.now() / 1000),
    finalState: null,
  };
  save(teacherPubkey, record);
}

/**
 * Mark a tracked escrow as settled with a final state.
 * Call this after a successful cancel/claim_success/claim_failure transaction.
 */
export function markFinalState(teacherPubkey, pda, finalState) {
  const record = load(teacherPubkey);
  if (!record[pda]) {
    // Escrow wasn't tracked locally — add a minimal entry
    record[pda] = { pda, deadline: null, createdAt: null, finalState };
  } else {
    record[pda].finalState = finalState;
  }
  save(teacherPubkey, record);
}

/**
 * Returns all tracked PDAs that are not currently live on-chain.
 * (Used to show closed escrows in the list.)
 *
 * @param {string}   teacherPubkey
 * @param {string[]} livePdas  - PDAs currently found on-chain
 * @returns {StoredEscrow[]}
 */
export function getClosedEntries(teacherPubkey, livePdas) {
  const record = load(teacherPubkey);
  const liveSet = new Set(livePdas);
  return Object.values(record).filter((e) => !liveSet.has(e.pda));
}
