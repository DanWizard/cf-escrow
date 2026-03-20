use cf_escrow_api::prelude::*;
use spl_associated_token_account::get_associated_token_address;
use steel::*;

pub fn process(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    // Dispatch on account count:
    //   SOL  (4): [teacher, student, escrow_info, system_program]
    //   token (8): [teacher, student, escrow_info, mint, student_ata, escrow_ata,
    //               token_program, system_program]
    match accounts.len() {
        4 => process_sol(accounts),
        8 => process_token(accounts),
        _ => Err(ProgramError::NotEnoughAccountKeys),
    }
}

fn process_sol(accounts: &[AccountInfo]) -> ProgramResult {
    let [teacher, student, escrow_info, _system_program] = accounts else {
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
        // caller passed SOL accounts but escrow holds tokens — mismatch
        return Err(ProgramError::InvalidArgument);
    }

    let stake = escrow.amount;

    // Transfer stake lamports from escrow PDA to student.
    // The program owns the PDA so direct lamport manipulation is safe.
    **escrow_info.lamports.borrow_mut() = escrow_info
        .lamports()
        .checked_sub(stake)
        .ok_or(ProgramError::InsufficientFunds)?;
    **student.lamports.borrow_mut() = student
        .lamports()
        .checked_add(stake)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Close the escrow account — remaining rent lamports go to teacher.
    close_account(escrow_info, teacher)?;

    Ok(())
}

fn process_token(accounts: &[AccountInfo]) -> ProgramResult {
    let [teacher, student, escrow_info, mint_info, student_ata, escrow_ata,
         token_program, system_program] = accounts else {
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

    // Verify ATAs are correctly derived.
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

    // Close the escrow token account — rent goes to teacher.
    // signature: (account_info, destination, owner, token_program, seeds)
    close_token_account_signed(escrow_ata, teacher, escrow_info, token_program, seeds)?;

    // Close the escrow PDA itself — rent goes to teacher.
    // We need system_program in scope for realloc; silence the unused warning.
    let _ = system_program;
    close_account(escrow_info, teacher)?;

    Ok(())
}
