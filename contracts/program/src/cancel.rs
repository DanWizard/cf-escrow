use cf_escrow_api::prelude::*;
use steel::*;

pub fn process(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [provider, escrow_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !provider.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let escrow = escrow_info.as_account::<Escrow>(&cf_escrow_api::ID)?;

    if escrow.provider != *provider.key {
        return Err(CfEscrowError::Unauthorized.into());
    }

    if escrow.client != Pubkey::default() {
        return Err(CfEscrowError::AlreadyAccepted.into());
    }

    // close the account, return rent to teacher
    escrow_info.close(provider)?;

    Ok(())
}
