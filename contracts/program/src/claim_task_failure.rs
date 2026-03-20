use cf_escrow_api::prelude::*;
use spl_associated_token_account::get_associated_token_address;
use steel::*;

pub fn process(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    // Dispatch on account count:
    //   SOL  (3): [teacher, escrow_info, system_program]
    //   token (8): [teacher, teacher_ata, escrow_info, mint, escrow_ata,
    //               token_program, associated_token_program, system_program]
    solana_program::msg!(
        "claim_task_failure hit, accounts: {}, data: {:?}",
        accounts.len(),
        _data
    );
    match accounts.len() {
        3 => process_sol(accounts),
        8 => process_token(accounts),
        _ => Err(ProgramError::NotEnoughAccountKeys),
    }
}

fn process_sol(accounts: &[AccountInfo]) -> ProgramResult {
    let [teacher, escrow_info, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !teacher.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let escrow = escrow_info.as_account::<Escrow>(&cf_escrow_api::ID)?;

    if *teacher.key != escrow.provider {
        return Err(CfEscrowError::Unauthorized.into());
    }
    if escrow.client == Pubkey::default() {
        return Err(CfEscrowError::NotAccepted.into());
    }
    if escrow.mint != Pubkey::default() {
        return Err(ProgramError::InvalidArgument);
    }
    if Clock::get()?.unix_timestamp <= escrow.deadline {
        return Err(CfEscrowError::DeadlineNotPassed.into());
    }

    // Teacher gets everything: stake + rent. close_account transfers all lamports.
    close_account(escrow_info, teacher)?;

    Ok(())
}

fn process_token(accounts: &[AccountInfo]) -> ProgramResult {
    let [teacher, teacher_ata, escrow_info, mint_info, escrow_ata,
         token_program, associated_token_program, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !teacher.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let escrow = escrow_info.as_account::<Escrow>(&cf_escrow_api::ID)?;

    if *teacher.key != escrow.provider {
        return Err(CfEscrowError::Unauthorized.into());
    }
    if escrow.client == Pubkey::default() {
        return Err(CfEscrowError::NotAccepted.into());
    }
    if escrow.mint == Pubkey::default() {
        return Err(ProgramError::InvalidArgument);
    }
    if *mint_info.key != escrow.mint {
        return Err(ProgramError::InvalidArgument);
    }
    if Clock::get()?.unix_timestamp <= escrow.deadline {
        return Err(CfEscrowError::DeadlineNotPassed.into());
    }

    // Verify ATAs.
    let expected_teacher_ata = get_associated_token_address(teacher.key, mint_info.key);
    if teacher_ata.key != &expected_teacher_ata {
        return Err(ProgramError::InvalidArgument);
    }
    let expected_escrow_ata = get_associated_token_address(escrow_info.key, mint_info.key);
    if escrow_ata.key != &expected_escrow_ata {
        return Err(ProgramError::InvalidArgument);
    }

    // Create teacher ATA if it doesn't exist yet.
    if teacher_ata.data_is_empty() {
        create_associated_token_account(
            teacher,
            teacher,
            teacher_ata,
            mint_info,
            system_program,
            token_program,
            associated_token_program,
        )?;
    }

    let stake = escrow.amount;
    let deadline_bytes = escrow.deadline.to_le_bytes();
    let seeds: &[&[u8]] = &[b"escrow", escrow.provider.as_ref(), deadline_bytes.as_ref()];

    // Transfer tokens to teacher — PDA-signed.
    transfer_signed(
        escrow_info,
        escrow_ata,
        teacher_ata,
        token_program,
        stake,
        seeds,
    )?;

    // Close the escrow token account — rent goes to teacher.
    close_token_account_signed(escrow_ata, teacher, escrow_info, token_program, seeds)?;

    // Close the escrow PDA — rent goes to teacher.
    let _ = system_program;
    close_account(escrow_info, teacher)?;

    Ok(())
}
