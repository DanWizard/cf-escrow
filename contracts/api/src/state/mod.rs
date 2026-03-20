mod escrow;

pub use escrow::*;

use steel::*;

use crate::consts::*;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum CfEscrowAccount {
    Escrow = 0,
}
