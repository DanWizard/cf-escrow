use cf_escrow_api::prelude::*;
use spl_associated_token_account::get_associated_token_address;
use steel::*;

/// One week in seconds.
const RECLAIM_GRACE_PERIOD: i64 = 7 * 24 * 60 * 60; // 604_800

pub fn process(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    match accounts.len() {
        3 => process_sol(accounts),
        7 => process_token(accounts),
        _ => Err(ProgramError::NotEnoughAccountKeys),
    }
}

fn process_sol(accounts: &[AccountInfo]) -> ProgramResult {
    // [student, escrow_info, system_program]
    let [student, escrow_info, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !student.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let escrow = escrow_info.as_account::<Escrow>(&cf_escrow_api::ID)?;

    // Must have been accepted by this student.
    if escrow.client == Pubkey::default() {
        return Err(CfEscrowError::NotAccepted.into());
    }
    if *student.key != escrow.client {
        return Err(CfEscrowError::Unauthorized.into());
    }
    if escrow.mint != Pubkey::default() {
        return Err(ProgramError::InvalidArgument);
    }

    // Reclaim window: deadline + 1 week must have passed.
    let now = Clock::get()?.unix_timestamp;
    if now <= escrow.deadline + RECLAIM_GRACE_PERIOD {
        return Err(CfEscrowError::ReclaimWindowNotOpen.into());
    }

    let stake = escrow.amount;

    // Return stake lamports to student directly.
    **escrow_info.lamports.borrow_mut() = escrow_info
        .lamports()
        .checked_sub(stake)
        .ok_or(ProgramError::InsufficientFunds)?;
    **student.lamports.borrow_mut() = student
        .lamports()
        .checked_add(stake)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Close escrow — remaining rent goes to student too.
    close_account(escrow_info, student)?;

    Ok(())
}

fn process_token(accounts: &[AccountInfo]) -> ProgramResult {
    // [student, escrow_info, mint, student_ata, escrow_ata, token_program, system_program]
    let [student, escrow_info, mint_info, student_ata, escrow_ata,
         token_program, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !student.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let escrow = escrow_info.as_account::<Escrow>(&cf_escrow_api::ID)?;

    if escrow.client == Pubkey::default() {
        return Err(CfEscrowError::NotAccepted.into());
    }
    if *student.key != escrow.client {
        return Err(CfEscrowError::Unauthorized.into());
    }
    if escrow.mint == Pubkey::default() {
        return Err(ProgramError::InvalidArgument);
    }
    if *mint_info.key != escrow.mint {
        return Err(ProgramError::InvalidArgument);
    }

    let now = Clock::get()?.unix_timestamp;
    if now <= escrow.deadline + RECLAIM_GRACE_PERIOD {
        return Err(CfEscrowError::ReclaimWindowNotOpen.into());
    }

    // Verify ATAs.
    let expected_student_ata = get_associated_token_address(&escrow.client, mint_info.key);
    if student_ata.key != &expected_student_ata {
        return Err(ProgramError::InvalidArgument);
    }
    let expected_escrow_ata = get_associated_token_address(escrow_info.key, mint_info.key);
    if escrow_ata.key != &expected_escrow_ata {
        return Err(ProgramError::InvalidArgument);
    }

    let stake = escrow.amount;
    let deadline_bytes = escrow.deadline.to_le_bytes();
    let seeds: &[&[u8]] = &[b"escrow", escrow.provider.as_ref(), deadline_bytes.as_ref()];

    // Return tokens to student — PDA-signed.
    transfer_signed(
        escrow_info,
        escrow_ata,
        student_ata,
        token_program,
        stake,
        seeds,
    )?;

    // Close escrow token account — rent goes to student.
    close_token_account_signed(escrow_ata, student, escrow_info, token_program, seeds)?;

    // Close escrow PDA — rent goes to student.
    let _ = system_program;
    close_account(escrow_info, student)?;

    Ok(())
}
