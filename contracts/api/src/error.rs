use steel::*;
use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq, IntoPrimitive)]
#[repr(u32)]
pub enum CfEscrowError {
    #[error("This escrow has already been accepted by a student")]
    AlreadyAccepted = 0,

    #[error("The deadline for this escrow has passed")]
    DeadlinePassed = 1,

    #[error("The provided mint is not allowed")]
    InvalidMint = 2,

    #[error("This escrow has not been accepted yet")]
    NotAccepted = 3,

    #[error("The deadline has not passed yet")]
    DeadlineNotPassed = 4,

    #[error("Signer is not the escrow provider or client")]
    Unauthorized = 5,

    #[error("The deadline must be in the future")]
    InvalidDeadline = 6,

    #[error("The reclaim window is not open yet (deadline + 1 week must pass)")]
    ReclaimWindowNotOpen = 7,
}

error!(CfEscrowError);
