use steel::*;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, TryFromPrimitive)]
pub enum TestTokensInstruction {
    Initialize = 0,
    MintTo = 1,
}

/// Creates both cfUSDC and cfUSDT mints. Caller becomes the mint authority.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Initialize {}

/// Mints tokens to a recipient. Only the stored authority may call this.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct MintTo {
    pub amount: [u8; 8], // raw amount (6 decimals, so 1_000_000 = 1 token)
    pub use_usdc: u8,    // 1 = cfUSDC, 0 = cfUSDT
    pub _pad: [u8; 7],
}

instruction!(TestTokensInstruction, Initialize);
instruction!(TestTokensInstruction, MintTo);
