use crate::prelude::*;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};
use steel::*;

fn escrow_pda(provider: &Pubkey, deadline: i64) -> Pubkey {
    let deadline_bytes = deadline.to_le_bytes();
    Pubkey::find_program_address(
        &[b"escrow", provider.as_ref(), deadline_bytes.as_ref()],
        &crate::ID,
    )
    .0
}

// ─── create ──────────────────────────────────────────────────────────────────

pub fn create(provider: Pubkey, deadline: i64) -> Instruction {
    let escrow_pda = escrow_pda(&provider, deadline);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(provider, true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: Create { deadline }.to_bytes().to_vec(),
    }
}

// ─── cancel ──────────────────────────────────────────────────────────────────

pub fn cancel(provider: Pubkey, deadline: i64) -> Instruction {
    let escrow_pda = escrow_pda(&provider, deadline);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(provider, true),
            AccountMeta::new(escrow_pda, false),
        ],
        data: Cancel {}.to_bytes().to_vec(),
    }
}

// ─── accept ──────────────────────────────────────────────────────────────────

pub fn accept_sol(student: Pubkey, provider: Pubkey, pda_deadline: i64, client_deadline: i64, amount: u64) -> Instruction {
    let escrow_pda = escrow_pda(&provider, pda_deadline);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(student, true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: Accept {
            amount,
            mint: Pubkey::default(),
            deadline: client_deadline,
        }
        .to_bytes()
        .to_vec(),
    }
}

pub fn accept_token(
    student: Pubkey,
    provider: Pubkey,
    pda_deadline: i64,
    client_deadline: i64,
    amount: u64,
    mint: Pubkey,
) -> Instruction {
    let escrow_pda = escrow_pda(&provider, pda_deadline);
    let student_ata = spl_associated_token_account::get_associated_token_address(&student, &mint);
    let escrow_ata = spl_associated_token_account::get_associated_token_address(&escrow_pda, &mint);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(student, true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(student_ata, false),
            AccountMeta::new(escrow_ata, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(spl_associated_token_account::ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: Accept { amount, mint, deadline: client_deadline }.to_bytes().to_vec(),
    }
}

// ─── claim_task_success ───────────────────────────────────────────────────────

/// Teacher judges success — student's stake is returned to them.
/// Call any time after the escrow has been accepted.
pub fn claim_task_success_sol(teacher: Pubkey, student: Pubkey, deadline: i64) -> Instruction {
    let escrow_pda = escrow_pda(&teacher, deadline);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(teacher, true),
            AccountMeta::new(student, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: ClaimTaskSuccess {}.to_bytes().to_vec(),
    }
}

pub fn claim_task_success_token(
    teacher: Pubkey,
    student: Pubkey,
    deadline: i64,
    mint: Pubkey,
) -> Instruction {
    let escrow_pda = escrow_pda(&teacher, deadline);
    let student_ata = spl_associated_token_account::get_associated_token_address(&student, &mint);
    let escrow_ata = spl_associated_token_account::get_associated_token_address(&escrow_pda, &mint);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(teacher, true),
            AccountMeta::new(student, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(student_ata, false),
            AccountMeta::new(escrow_ata, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: ClaimTaskSuccess {}.to_bytes().to_vec(),
    }
}

// ─── claim_task_failure ───────────────────────────────────────────────────────

/// Teacher judges failure — teacher keeps the stake. Only callable after deadline.
pub fn claim_task_failure_sol(teacher: Pubkey, deadline: i64) -> Instruction {
    let escrow_pda = escrow_pda(&teacher, deadline);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(teacher, true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: ClaimTaskFailure {}.to_bytes().to_vec(),
    }
}

// ─── reclaim ─────────────────────────────────────────────────────────────────

/// Student reclaims their stake after deadline + 1 week with no teacher settlement.
pub fn reclaim_sol(student: Pubkey, provider: Pubkey, deadline: i64) -> Instruction {
    let escrow_pda = escrow_pda(&provider, deadline);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(student, true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: Reclaim {}.to_bytes().to_vec(),
    }
}

pub fn reclaim_token(
    student: Pubkey,
    provider: Pubkey,
    deadline: i64,
    mint: Pubkey,
) -> Instruction {
    let escrow_pda = escrow_pda(&provider, deadline);
    let student_ata = spl_associated_token_account::get_associated_token_address(&student, &mint);
    let escrow_ata = spl_associated_token_account::get_associated_token_address(&escrow_pda, &mint);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(student, true),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(student_ata, false),
            AccountMeta::new(escrow_ata, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: Reclaim {}.to_bytes().to_vec(),
    }
}

pub fn claim_task_failure_token(teacher: Pubkey, deadline: i64, mint: Pubkey) -> Instruction {
    let escrow_pda = escrow_pda(&teacher, deadline);
    let teacher_ata = spl_associated_token_account::get_associated_token_address(&teacher, &mint);
    let escrow_ata = spl_associated_token_account::get_associated_token_address(&escrow_pda, &mint);
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(teacher, true),
            AccountMeta::new(teacher_ata, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(escrow_ata, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(spl_associated_token_account::ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: ClaimTaskFailure {}.to_bytes().to_vec(),
    }
}
