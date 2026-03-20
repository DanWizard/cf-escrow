use steel::*;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, TryFromPrimitive)]
pub enum CfEscrowInstruction {
    Create = 0,
    Cancel = 1,
    Accept = 2,
    ClaimTaskFailure = 3,
    ClaimTaskSuccess = 4,
    Reclaim = 5,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Create {
    pub deadline: i64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Cancel {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Accept {
    pub amount: u64,
    pub mint: Pubkey,
    pub deadline: i64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct ClaimTaskSuccess {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct ClaimTaskFailure {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Reclaim {}

instruction!(CfEscrowInstruction, Create);
instruction!(CfEscrowInstruction, Cancel);
instruction!(CfEscrowInstruction, Accept);
instruction!(CfEscrowInstruction, ClaimTaskSuccess);
instruction!(CfEscrowInstruction, ClaimTaskFailure);
instruction!(CfEscrowInstruction, Reclaim);
