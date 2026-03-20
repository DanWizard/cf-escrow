use cf_escrow_api::prelude::*;
use solana_program::{program::invoke, system_instruction};
use spl_associated_token_account::get_associated_token_address;
use steel::*;

pub fn process(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 48 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[..8].try_into().unwrap());
    let mint = Pubkey::try_from(&data[8..40]).unwrap();
    let client_deadline = i64::from_le_bytes(data[40..48].try_into().unwrap());
    let is_native = mint == Pubkey::default();

    if is_native {
        let [student, escrow_info, system_program] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        if !student.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }
        if amount == 0 {
            return Err(ProgramError::InvalidArgument);
        }
        let escrow = escrow_info.as_account_mut::<Escrow>(&cf_escrow_api::ID)?;
        if escrow.client != Pubkey::default() {
            return Err(CfEscrowError::AlreadyAccepted.into());
        }
        if escrow.deadline <= Clock::get()?.unix_timestamp {
            return Err(CfEscrowError::DeadlinePassed.into());
        }
        // Steel has no SOL lamport transfer helper — use solana_program directly
        invoke(
            &system_instruction::transfer(student.key, escrow_info.key, amount),
            &[student.clone(), escrow_info.clone(), system_program.clone()],
        )?;
        escrow.client = *student.key;
        escrow.mint = Pubkey::default();
        escrow.amount = amount;
        escrow.deadline = client_deadline;
    } else {
        let [student, escrow_info, mint_info, student_ata, escrow_ata,
             token_program, associated_token_program, system_program] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        if !student.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }
        if amount == 0 {
            return Err(ProgramError::InvalidArgument);
        }
        let escrow = escrow_info.as_account_mut::<Escrow>(&cf_escrow_api::ID)?;
        if escrow.client != Pubkey::default() {
            return Err(CfEscrowError::AlreadyAccepted.into());
        }
        if escrow.deadline <= Clock::get()?.unix_timestamp {
            return Err(CfEscrowError::DeadlinePassed.into());
        }
        let expected_student_ata = get_associated_token_address(student.key, mint_info.key);
        if student_ata.key != &expected_student_ata {
            return Err(ProgramError::InvalidArgument);
        }
        let expected_escrow_ata = get_associated_token_address(escrow_info.key, mint_info.key);
        if escrow_ata.key != &expected_escrow_ata {
            return Err(ProgramError::InvalidArgument);
        }
        if escrow_ata.data_is_empty() {
            create_associated_token_account(
                student,
                escrow_info,
                escrow_ata,
                mint_info,
                system_program,
                token_program,
                associated_token_program,
            )?;
        }
        // Student is a wallet signer — use transfer(), not transfer_signed()
        // signature: (authority, from_ata, to_ata, token_program, amount)
        transfer(student, student_ata, escrow_ata, token_program, amount)?;
        escrow.client = *student.key;
        escrow.mint = *mint_info.key;
        escrow.amount = amount;
        escrow.deadline = client_deadline;
    }
    Ok(())
}
