use super::TestTokensAccount;
use steel::*;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct Config {
    pub authority: Pubkey,    // wallet allowed to call MintTo
    pub cfusdc_mint: Pubkey,  // cfUSDC mint address (PDA)
    pub cfusdt_mint: Pubkey,  // cfUSDT mint address (PDA)
    pub bump: u64,
}

account!(TestTokensAccount, Config);
