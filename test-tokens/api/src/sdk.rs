use crate::prelude::*;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program, sysvar,
};

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &crate::ID).0
}

pub fn mint_authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &crate::ID).0
}

pub fn cfusdc_mint_pda() -> Pubkey {
    Pubkey::find_program_address(&[CFUSDC_SEED], &crate::ID).0
}

pub fn cfusdt_mint_pda() -> Pubkey {
    Pubkey::find_program_address(&[CFUSDT_SEED], &crate::ID).0
}

pub fn initialize(payer: Pubkey) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(cfusdc_mint_pda(), false),
            AccountMeta::new(cfusdt_mint_pda(), false),
            AccountMeta::new_readonly(mint_authority_pda(), false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(sysvar::rent::ID, false),
        ],
        data: Initialize {}.to_bytes().to_vec(),
    }
}

pub fn mint_to(
    authority: Pubkey,
    recipient: Pubkey,
    amount: [u8; 8],
    use_usdc: bool,
) -> Instruction {
    let mint = if use_usdc {
        cfusdc_mint_pda()
    } else {
        cfusdt_mint_pda()
    };
    let recipient_ata =
        spl_associated_token_account::get_associated_token_address(&recipient, &mint);

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new(mint, false),
            AccountMeta::new_readonly(mint_authority_pda(), false),
            AccountMeta::new_readonly(recipient, false),
            AccountMeta::new(recipient_ata, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(spl_associated_token_account::ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: MintTo {
            amount,
            use_usdc: use_usdc as u8,
            _pad: [0; 7],
        }
        .to_bytes()
        .to_vec(),
    }
}
