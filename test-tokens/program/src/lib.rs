mod initialize;
mod mint_to;

use test_tokens_api::prelude::*;
use steel::*;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let (ix, data) =
        parse_instruction::<TestTokensInstruction>(&test_tokens_api::ID, program_id, data)?;

    match ix {
        TestTokensInstruction::Initialize => initialize::process(accounts, data),
        TestTokensInstruction::MintTo => mint_to::process(accounts, data),
    }
}

entrypoint!(process_instruction);
