use solana_program::program::invoke_signed;
use steel::*;
use test_tokens_api::prelude::*;

pub fn process(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [authority, config_info, mint_info, mint_authority_info, recipient, recipient_ata, token_program, ata_program, system_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let args = MintTo::try_from_bytes(data)?;
    let amount = u64::from_le_bytes(args.amount);
    // let amount = args.amount;
    let use_usdc = args.use_usdc == 1;

    // verify caller is the stored authority
    let config = config_info.as_account::<Config>(&test_tokens_api::ID)?;
    if config.authority != *authority.key {
        return Err(TestTokensError::Unauthorized.into());
    }

    // verify the mint matches the requested token
    let expected_mint = if use_usdc {
        config.cfusdc_mint
    } else {
        config.cfusdt_mint
    };
    if *mint_info.key != expected_mint {
        return Err(ProgramError::InvalidAccountData);
    }

    let (mint_authority_pda, mint_authority_bump) =
        Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &test_tokens_api::ID);
    assert_eq!(mint_authority_info.key, &mint_authority_pda);

    // create ATA if it doesn't exist yet
    let expected_ata =
        spl_associated_token_account::get_associated_token_address(recipient.key, mint_info.key);
    assert_eq!(recipient_ata.key, &expected_ata);

    if recipient_ata.data_is_empty() {
        solana_program::program::invoke(
            &spl_associated_token_account::instruction::create_associated_token_account(
                authority.key,
                recipient.key,
                mint_info.key,
                &spl_token::ID,
            ),
            &[
                authority.clone(),
                recipient_ata.clone(),
                recipient.clone(),
                mint_info.clone(),
                system_program.clone(),
                token_program.clone(),
                ata_program.clone(),
            ],
        )?;
    }

    // mint tokens
    invoke_signed(
        &spl_token::instruction::mint_to(
            &spl_token::ID,
            mint_info.key,
            recipient_ata.key,
            &mint_authority_pda,
            &[],
            amount,
        )?,
        &[
            mint_info.clone(),
            recipient_ata.clone(),
            mint_authority_info.clone(),
        ],
        &[&[MINT_AUTHORITY_SEED, &[mint_authority_bump]]],
    )?;

    solana_program::msg!(
        "minted {} {} to {}",
        amount,
        if use_usdc { "cfUSDC" } else { "cfUSDT" },
        recipient.key
    );

    Ok(())
}
