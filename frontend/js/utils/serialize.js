/**
 * serialize.js
 * Converts instruction parameters into the raw byte buffers the
 * Steel program expects. Format: [discriminator_u8, ...struct_bytes_le]
 *
 * Mirrors the to_bytes() output of each instruction! macro in api/src/instruction.rs.
 */

/** Write a signed 64-bit integer as 8 little-endian bytes into a DataView. */
function writeI64LE(view, offset, value) {
  const big = BigInt(Math.floor(value));
  view.setUint32(offset, Number(big & 0xffffffffn), true);
  view.setUint32(offset + 4, Number((big >> 32n) & 0xffffffffn), true);
}

/** Write an unsigned 64-bit integer as 8 little-endian bytes into a DataView. */
function writeU64LE(view, offset, value) {
  const big = BigInt(value);
  view.setUint32(offset, Number(big & 0xffffffffn), true);
  view.setUint32(offset + 4, Number((big >> 32n) & 0xffffffffn), true);
}

/**
 * Create { deadline: i64 }  →  [0x00, i64_le(deadline)]
 */
export function serializeCreate(deadlineUnixSeconds) {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint8(0, 0); // discriminator
  writeI64LE(view, 1, deadlineUnixSeconds);
  return new Uint8Array(buf);
}

/**
 * Cancel {}  →  [0x01]
 */
export function serializeCancel() {
  return new Uint8Array([1]);
}

/**
 * ClaimTaskFailure {}  →  [0x03]
 */
export function serializeClaimTaskFailure() {
  return new Uint8Array([3]);
}

/**
 * ClaimTaskSuccess {}  →  [0x04]
 */
export function serializeClaimTaskSuccess() {
  return new Uint8Array([4]);
}

/**
 * Serialize a deadline value (i64) to an 8-byte Uint8Array (LE).
 * Used for PDA seed derivation.
 */
export function deadlineToBytes(deadlineUnixSeconds) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  writeI64LE(view, 0, deadlineUnixSeconds);
  return new Uint8Array(buf);
}
