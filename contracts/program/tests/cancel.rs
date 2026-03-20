use cf_escrow_api::{prelude::*, sdk};
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
};

mod helpers;
use helpers::*;

fn future_deadline() -> i64 {
    4_070_908_800 // 2099-01-01
}

#[test]
fn test_cancel_escrow() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, deadline);

    // Confirm the account exists before cancel.
    assert!(svm.get_account(&escrow_addr).is_some());

    let ix = sdk::cancel(teacher.pubkey(), deadline);
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        blockhash,
    );
    svm.send_transaction(tx).expect("cancel should succeed");

    // After cancel the account should be gone (lamports returned to teacher).
    let lamports_after = svm.get_balance(&escrow_addr).unwrap_or(0);
    assert_eq!(
        lamports_after, 0,
        "escrow should have zero lamports after cancel (closed)"
    );
}

#[test]
fn test_cancel_escrow_unauthorized() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    // A different keypair (not the teacher) tries to cancel.
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    // Build cancel ix but with teacher's pubkey as the "provider" arg in the PDA seed,
    // while the actual signer is attacker — the program checks the signer matches.
    let ix = sdk::cancel(teacher.pubkey(), deadline);
    let blockhash = svm.latest_blockhash();

    // We need attacker as the first account but the SDK builds the ix with teacher
    // as the mutable signer — swap the account manually to simulate the attack.
    let mut bad_ix = ix.clone();
    bad_ix.accounts[0].pubkey = attacker.pubkey();
    bad_ix.accounts[0].is_signer = true;

    let tx = Transaction::new_signed_with_payer(
        &[bad_ix],
        Some(&payer.pubkey()),
        &[&payer, &attacker],
        blockhash,
    );
    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "unauthorized cancel should fail");
}

#[test]
fn test_cancel_escrow_already_accepted() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    // Student accepts first.
    let student = Keypair::new();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let stake = 500_000_000u64;
    let accept_ix = sdk::accept_sol(student.pubkey(), teacher.pubkey(), deadline, deadline, stake);
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[accept_ix],
        Some(&payer.pubkey()),
        &[&payer, &student],
        blockhash,
    ))
    .expect("accept_sol should succeed");

    // Now teacher tries to cancel — should fail because client != default.
    let cancel_ix = sdk::cancel(teacher.pubkey(), deadline);
    let blockhash = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[cancel_ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        blockhash,
    ));
    assert!(result.is_err(), "cancel after accept should fail");
}
