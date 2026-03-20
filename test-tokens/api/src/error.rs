use steel::*;
use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq, IntoPrimitive)]
#[repr(u32)]
pub enum TestTokensError {
    #[error("Signer is not the mint authority")]
    Unauthorized = 0,

    #[error("Program already initialized")]
    AlreadyInitialized = 1,
}

error!(TestTokensError);
