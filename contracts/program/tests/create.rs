use cf_escrow_api::prelude::*;
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

mod helpers;
use helpers::*;

/// A deadline far in the future so the program never sees it as expired.
fn future_deadline() -> i64 {
    // 2099-01-01 00:00:00 UTC
    4_070_908_800
}

#[test]
fn test_create_escrow() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, deadline);

    let escrow = read_escrow(&svm, &escrow_addr);
    assert_eq!(escrow.provider, teacher.pubkey(), "provider mismatch");
    assert_eq!(escrow.client, Pubkey::default(), "client should be unset");
    assert_eq!(escrow.mint, Pubkey::default(), "mint should be unset");
    assert_eq!(escrow.amount, 0, "amount should be 0");
    assert_eq!(escrow.deadline, deadline, "deadline mismatch");
}

#[test]
fn test_create_escrow_duplicate_fails() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    // Second create with the same (teacher, deadline) — PDA already exists, should fail.
    let ix = cf_escrow_api::sdk::create(teacher.pubkey(), deadline);
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        blockhash,
    );
    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "duplicate create should fail");
}
