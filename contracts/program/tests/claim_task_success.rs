use cf_escrow_api::sdk;
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
};

mod helpers;
use helpers::*;

fn future_deadline() -> i64 {
    4_070_908_800
}

// ─── SOL path ────────────────────────────────────────────────────────────────

/// Full happy path: teacher creates, student stakes SOL, teacher judges success,
/// student gets stake back, escrow is closed, teacher gets rent.
#[test]
fn test_claim_success_sol() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let deadline = future_deadline();
    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, deadline);

    let stake = 500_000_000u64;
    let accept_ix = sdk::accept_sol(student.pubkey(), teacher.pubkey(), deadline, deadline, stake);
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[accept_ix],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .expect("accept_sol failed");

    let student_before = svm.get_balance(&student.pubkey()).unwrap();
    let teacher_before = svm.get_balance(&teacher.pubkey()).unwrap();

    let ix = sdk::claim_task_success_sol(teacher.pubkey(), student.pubkey(), deadline);
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ))
    .expect("claim_task_success_sol failed");

    // Student gets stake back.
    let student_after = svm.get_balance(&student.pubkey()).unwrap();
    assert_eq!(
        student_after,
        student_before + stake,
        "student didn't get stake back"
    );

    // Teacher's balance increased by at least the rent (escrow closed to teacher).
    let teacher_after = svm.get_balance(&teacher.pubkey()).unwrap();
    assert!(
        teacher_after > teacher_before,
        "teacher should receive rent"
    );

    // Escrow is closed.
    assert_eq!(svm.get_balance(&escrow_addr).unwrap_or(0), 0);
}

/// Student cannot call claim_task_success (student is not a teacher/signer on that ix).
#[test]
fn test_claim_success_student_cannot_call() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);
    let stake = 100_000_000u64;
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_sol(
            student.pubkey(),
            teacher.pubkey(),
            deadline,
            deadline,
            stake,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .unwrap();

    // Build the success ix but swap teacher for student as the signer.
    let mut bad_ix = sdk::claim_task_success_sol(teacher.pubkey(), student.pubkey(), deadline);
    bad_ix.accounts[0].pubkey = student.pubkey();
    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[bad_ix],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ));
    assert!(
        result.is_err(),
        "student should not be able to call claim_task_success"
    );
}

/// Claiming success on a not-yet-accepted escrow should fail.
#[test]
fn test_claim_success_not_accepted_fails() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    let ix = sdk::claim_task_success_sol(teacher.pubkey(), student.pubkey(), deadline);
    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ));
    assert!(
        result.is_err(),
        "claiming success on unaccepted escrow should fail"
    );
}

// ─── token path ──────────────────────────────────────────────────────────────

/// Teacher judges success on a token escrow — student's tokens are returned.
#[test]
fn test_claim_success_token() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let mint_authority = seed_mint(&mut svm, USDC_MINT);
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000).unwrap();

    let deadline = future_deadline();
    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, deadline);

    let student_ata = create_ata(&mut svm, &payer, &student.pubkey(), &USDC_MINT);
    let amount = 100_000_000u64;
    mint_tokens_to(&mut svm, &payer, &USDC_MINT, &student_ata, &mint_authority, amount);

    // Student accepts.
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_token(
            student.pubkey(),
            teacher.pubkey(),
            deadline,
            deadline,
            amount,
            USDC_MINT,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .expect("accept_token failed");

    // Teacher judges success.
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::claim_task_success_token(
            teacher.pubkey(),
            student.pubkey(),
            deadline,
            USDC_MINT,
        )],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ))
    .expect("claim_task_success_token failed");

    // Student's ATA should be refunded.
    assert_eq!(
        read_token_account(&svm, &student_ata).amount,
        amount,
        "student ATA should be refunded"
    );

    // Escrow closed.
    assert_eq!(svm.get_balance(&escrow_addr).unwrap_or(0), 0);
}
