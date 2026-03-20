use cf_escrow_api::{prelude::*, sdk::create};
use litesvm::LiteSVM;
use solana_sdk::{
    account::Account,
    program_option::COption,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use spl_token::state::{Account as TokenAccount, Mint};

/// cfUSDC mint — PDA of the test-tokens program
/// (C3YBZVUriPRKb9RtDLrjVW4tvsN85gi9KQ7x2usx1xoF, seed: b"cfUSDC").
pub const USDC_MINT: Pubkey = solana_program::pubkey!("GetYhuMGKXbn47yrFzsMSFXLyAPzGSjhHJxY7w6RxmK1");

/// cfUSDT mint — PDA of the test-tokens program (seed: b"cfUSDT").
pub const USDT_MINT: Pubkey = solana_program::pubkey!("DfKYQgxm2p7nU6Y8iSTNJ8AcoUCvQc7CudBJxoHPuWgP");

/// Path to the compiled SBF binary.
/// CARGO_MANIFEST_DIR is program/, so /../target/deploy reaches workspace root.
/// Run `cargo build-sbf` before running tests.
pub const PROGRAM_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../target/deploy/cf_escrow_program.so",
);

/// Create a fresh LiteSVM instance with our program loaded.
/// LiteSVM::new() already includes: system program, SPL token, token-2022,
/// SPL memo, and SPL associated-token-account.
pub fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(cf_escrow_api::ID, PROGRAM_SO)
        .expect("program .so not found — run `cargo build-sbf` first");

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

    (svm, payer)
}

/// Derive the escrow PDA for a given provider and deadline.
pub fn escrow_pda(provider: &Pubkey, deadline: i64) -> Pubkey {
    let deadline_bytes = deadline.to_le_bytes();
    let (pda, _) = Pubkey::find_program_address(
        &[b"escrow", provider.as_ref(), deadline_bytes.as_ref()],
        &cf_escrow_api::ID,
    );
    pda
}

/// Send a create instruction and return the escrow PDA.
pub fn create_escrow(
    svm: &mut LiteSVM,
    payer: &Keypair,
    teacher: &Keypair,
    deadline: i64,
) -> Pubkey {
    let ix = create(teacher.pubkey(), deadline);
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[payer, teacher],
        blockhash,
    );
    svm.send_transaction(tx).expect("create_escrow tx failed");
    escrow_pda(&teacher.pubkey(), deadline)
}

/// Read the Escrow struct from an account's data (skipping the 8-byte discriminator).
pub fn read_escrow(svm: &LiteSVM, pda: &Pubkey) -> Escrow {
    let acct = svm.get_account(pda).expect("escrow account not found");
    assert!(acct.data.len() >= 8 + std::mem::size_of::<Escrow>());
    *bytemuck::from_bytes::<Escrow>(&acct.data[8..8 + std::mem::size_of::<Escrow>()])
}

/// Seed a mock SPL-Token mint at `mint_pubkey` in the LiteSVM state.
/// Returns the mint-authority keypair (tests own it directly — no PDA).
pub fn seed_mint(svm: &mut LiteSVM, mint_pubkey: Pubkey) -> Keypair {
    let authority = Keypair::new();
    let mut data = vec![0u8; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: COption::Some(authority.pubkey()),
            supply: 0,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    svm.set_account(
        mint_pubkey,
        Account {
            lamports: 1_461_600,
            data,
            owner: spl_token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    authority
}

/// Create an ATA for `owner` on `mint`, paid by `payer`. Returns the ATA address.
pub fn create_ata(svm: &mut LiteSVM, payer: &Keypair, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    let ix = spl_associated_token_account::instruction::create_associated_token_account(
        &payer.pubkey(),
        owner,
        mint,
        &spl_token::ID,
    );
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[payer],
        bh,
    ))
    .expect("create_ata failed");
    spl_associated_token_account::get_associated_token_address(owner, mint)
}

/// Mint `amount` tokens to `dest_ata` using the given authority.
pub fn mint_tokens_to(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    dest_ata: &Pubkey,
    authority: &Keypair,
    amount: u64,
) {
    let ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        mint,
        dest_ata,
        &authority.pubkey(),
        &[&authority.pubkey()],
        amount,
    )
    .unwrap();
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[payer, authority],
        bh,
    ))
    .expect("mint_tokens_to failed");
}

/// Read an SPL token account's state from LiteSVM.
pub fn read_token_account(svm: &LiteSVM, ata: &Pubkey) -> TokenAccount {
    let acct = svm.get_account(ata).expect("token account not found");
    TokenAccount::unpack(&acct.data).unwrap()
}
