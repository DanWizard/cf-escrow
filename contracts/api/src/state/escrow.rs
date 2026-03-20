use super::CfEscrowAccount;
use steel::*;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct Escrow {
    pub provider: Pubkey,
    pub client: Pubkey, // all zeros = "not set yet"
    pub mint: Pubkey,   // all zeros = "not set yet"
    pub amount: u64,
    pub deadline: i64,
    pub bump: u64,
}

account!(CfEscrowAccount, Escrow);
