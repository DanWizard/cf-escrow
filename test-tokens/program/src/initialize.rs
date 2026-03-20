use solana_program::{program::invoke_signed, rent::Rent, system_instruction, sysvar::Sysvar};
use spl_token::solana_program::program_pack::Pack;
use steel::*;
use test_tokens_api::prelude::*;

pub fn process(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [payer, config_info, cfusdc_mint_info, cfusdt_mint_info, mint_authority_info, token_program, system_program, rent_sysvar] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *token_program.key != spl_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if *system_program.key != solana_program::system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if config_info.data_len() > 0 {
        return Err(TestTokensError::AlreadyInitialized.into());
    }

    let (config_pda, config_bump) =
        Pubkey::find_program_address(&[CONFIG_SEED], &test_tokens_api::ID);
    let (mint_authority_pda, _) =
        Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &test_tokens_api::ID);
    let (cfusdc_pda, cfusdc_bump) =
        Pubkey::find_program_address(&[CFUSDC_SEED], &test_tokens_api::ID);
    let (cfusdt_pda, cfusdt_bump) =
        Pubkey::find_program_address(&[CFUSDT_SEED], &test_tokens_api::ID);

    assert_eq!(config_info.key, &config_pda);
    assert_eq!(cfusdc_mint_info.key, &cfusdc_pda);
    assert_eq!(cfusdt_mint_info.key, &cfusdt_pda);
    assert_eq!(mint_authority_info.key, &mint_authority_pda);

    let rent = Rent::get()?;
    let mint_lamports = rent.minimum_balance(spl_token::state::Mint::LEN);

    // ── create cfUSDC mint ────────────────────────────────────────────────────

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            cfusdc_mint_info.key,
            mint_lamports,
            spl_token::state::Mint::LEN as u64,
            &spl_token::ID,
        ),
        &[
            payer.clone(),
            cfusdc_mint_info.clone(),
            system_program.clone(),
        ],
        &[&[CFUSDC_SEED, &[cfusdc_bump]]],
    )?;

    invoke_signed(
        &spl_token::instruction::initialize_mint(
            &spl_token::ID,
            cfusdc_mint_info.key,
            &mint_authority_pda,
            None,
            TOKEN_DECIMALS,
        )?,
        &[cfusdc_mint_info.clone(), rent_sysvar.clone()],
        &[],
    )?;

    // ── create cfUSDT mint ────────────────────────────────────────────────────

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            cfusdt_mint_info.key,
            mint_lamports,
            spl_token::state::Mint::LEN as u64,
            &spl_token::ID,
        ),
        &[
            payer.clone(),
            cfusdt_mint_info.clone(),
            system_program.clone(),
        ],
        &[&[CFUSDT_SEED, &[cfusdt_bump]]],
    )?;

    invoke_signed(
        &spl_token::instruction::initialize_mint(
            &spl_token::ID,
            cfusdt_mint_info.key,
            &mint_authority_pda,
            None,
            TOKEN_DECIMALS,
        )?,
        &[cfusdt_mint_info.clone(), rent_sysvar.clone()],
        &[],
    )?;

    // ── create config account ─────────────────────────────────────────────────

    create_program_account::<Config>(
        config_info,
        system_program,
        payer,
        &test_tokens_api::ID,
        &[CONFIG_SEED],
    )?;

    let config = config_info.as_account_mut::<Config>(&test_tokens_api::ID)?;
    config.authority = *payer.key;
    config.cfusdc_mint = *cfusdc_mint_info.key;
    config.cfusdt_mint = *cfusdt_mint_info.key;
    config.bump = config_bump as u64;

    solana_program::msg!("cfUSDC mint: {}", cfusdc_mint_info.key);
    solana_program::msg!("cfUSDT mint: {}", cfusdt_mint_info.key);
    solana_program::msg!("mint authority (PDA): {}", mint_authority_pda);
    solana_program::msg!("authority: {}", payer.key);

    Ok(())
}
