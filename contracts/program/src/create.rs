use cf_escrow_api::prelude::*;
use solana_program::msg;
use steel::*;

pub fn process(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    msg!("create hit, data len: {}, bytes: {:?}", data.len(), data);
    // 1. parse accounts
    let [provider, escrow_info, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    msg!("accounts parsed");

    let deadline = i64::from_le_bytes(data[..8].try_into().unwrap());
    msg!("args parsed, deadline: {}", deadline);
    // 3. validate
    // instead of assert_signer
    if !provider.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    msg!("signer check passed");

    // instead of assert_program
    if system_program.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    msg!("system program check passed");

    // deadline must be in the future
    let clock = Clock::get()?;
    if deadline <= clock.unix_timestamp {
        return Err(CfEscrowError::InvalidDeadline.into());
    }
    msg!("deadline check passed");

    let client = Pubkey::default();
    let deadline_bytes = deadline.to_le_bytes();

    // 4. derive escrow PDA
    let escrow_seeds = &[b"escrow", provider.key.as_ref(), deadline_bytes.as_ref()];
    let (escrow_pda, bump) = Pubkey::find_program_address(escrow_seeds, &cf_escrow_api::ID);
    assert_eq!(escrow_info.key, &escrow_pda);
    // make sure it doesn't already exist
    if escrow_info.data_len() > 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    create_program_account::<Escrow>(
        escrow_info,        // the PDA account to create
        system_program,     // system program
        provider,           // who pays rent
        &cf_escrow_api::ID, // owner (your program)
        &[
            // seeds WITHOUT bump, Steel adds it automatically
            b"escrow",
            provider.key.as_ref(),
            deadline_bytes.as_ref(),
        ],
    )?;

    let escrow = escrow_info.as_account_mut::<Escrow>(&cf_escrow_api::ID)?;
    escrow.provider = *provider.key;
    escrow.client = Pubkey::default();
    escrow.mint = Pubkey::default();
    escrow.amount = 0;
    escrow.deadline = deadline;
    escrow.bump = Pubkey::find_program_address(
        &[b"escrow", provider.key.as_ref(), deadline_bytes.as_ref()],
        &cf_escrow_api::ID,
    )
    .1 as u64;

    Ok(())
}
