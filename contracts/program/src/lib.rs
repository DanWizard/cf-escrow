mod accept;
mod cancel;
mod claim_task_failure;
mod claim_task_success;
mod create;
mod reclaim;

use cf_escrow_api::prelude::*;
use solana_program::msg;
use steel::*;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    msg!("process_instruction hit, data: {:?}", data);

    let (ix, data) =
        parse_instruction::<CfEscrowInstruction>(&cf_escrow_api::ID, program_id, data)?;

    match ix {
        CfEscrowInstruction::Create => create::process(accounts, data),
        CfEscrowInstruction::Cancel => cancel::process(accounts, data),
        CfEscrowInstruction::Accept => accept::process(accounts, data),
        CfEscrowInstruction::ClaimTaskSuccess => claim_task_success::process(accounts, data),
        CfEscrowInstruction::ClaimTaskFailure => claim_task_failure::process(accounts, data),
        CfEscrowInstruction::Reclaim => reclaim::process(accounts, data),
    }
}

entrypoint!(process_instruction);
