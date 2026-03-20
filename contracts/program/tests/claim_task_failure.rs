use cf_escrow_api::sdk;
use solana_sdk::{
    clock::Clock,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

mod helpers;
use helpers::*;

fn future_deadline() -> i64 {
    4_070_908_800
}

// Warp svm past the given deadline so Clock::unix_timestamp > deadline.
fn warp_past(svm: &mut litesvm::LiteSVM, deadline: i64) {
    let mut clock: solana_sdk::clock::Clock = svm.get_sysvar();
    clock.slot += 1; // advance slot so cache stays valid
    clock.unix_timestamp = deadline + 1; // set time past deadline
    svm.set_sysvar(&clock);
}

// ─── SOL path ────────────────────────────────────────────────────────────────

/// Full happy path: after deadline, teacher claims failure, gets stake + rent.
#[test]
fn test_claim_failure_sol() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let deadline = future_deadline();
    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, deadline);

    let stake = 500_000_000u64;
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
    .expect("accept_sol failed");

    let teacher_before = svm.get_balance(&teacher.pubkey()).unwrap();

    warp_past(&mut svm, deadline);

    let ix = sdk::claim_task_failure_sol(teacher.pubkey(), deadline);
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ))
    .expect("claim_task_failure_sol failed");

    // Teacher gained the stake plus the escrow rent.
    let teacher_after = svm.get_balance(&teacher.pubkey()).unwrap();
    assert!(
        teacher_after >= teacher_before + stake,
        "teacher should receive stake"
    );

    // Escrow is closed.
    assert_eq!(svm.get_balance(&escrow_addr).unwrap_or(0), 0);
}

/// Teacher cannot claim failure BEFORE the deadline.
#[test]
fn test_claim_failure_before_deadline_fails() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_sol(
            student.pubkey(),
            teacher.pubkey(),
            deadline,
            deadline,
            100_000_000,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .unwrap();

    // Deadline has NOT passed — should fail.
    let ix = sdk::claim_task_failure_sol(teacher.pubkey(), deadline);
    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ));
    assert!(
        result.is_err(),
        "failure claim before deadline should be rejected"
    );
}

/// Student cannot call claim_task_failure.
#[test]
fn test_claim_failure_student_cannot_call() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_sol(
            student.pubkey(),
            teacher.pubkey(),
            deadline,
            deadline,
            100_000_000,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .unwrap();

    warp_past(&mut svm, deadline);

    let mut bad_ix = sdk::claim_task_failure_sol(teacher.pubkey(), deadline);
    // Swap the teacher account for the student as signer.
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
        "student should not be able to claim failure"
    );
}

/// Claiming failure on a not-yet-accepted escrow should fail.
#[test]
fn test_claim_failure_not_accepted_fails() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    warp_past(&mut svm, deadline);

    let ix = sdk::claim_task_failure_sol(teacher.pubkey(), deadline);
    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ));
    assert!(
        result.is_err(),
        "failure on unaccepted escrow should be rejected"
    );
}

// ─── token path ──────────────────────────────────────────────────────────────

/// Teacher claims failure on a token escrow after deadline — teacher receives the tokens.
#[test]
fn test_claim_failure_token() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let mint_authority = seed_mint(&mut svm, USDC_MINT);
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

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

    warp_past(&mut svm, deadline);

    // Teacher claims failure — teacher ATA is created by the program.
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::claim_task_failure_token(
            teacher.pubkey(),
            deadline,
            USDC_MINT,
        )],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ))
    .expect("claim_task_failure_token failed");

    // Teacher ATA holds the tokens.
    let teacher_ata =
        spl_associated_token_account::get_associated_token_address(&teacher.pubkey(), &USDC_MINT);
    assert_eq!(
        read_token_account(&svm, &teacher_ata).amount,
        amount,
        "teacher should receive the staked tokens"
    );

    // Student ATA should be empty.
    assert_eq!(
        read_token_account(&svm, &student_ata).amount,
        0,
        "student ATA should be empty after failure"
    );
}

/// Token failure before deadline is rejected.
#[test]
fn test_claim_failure_token_before_deadline_fails() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let mint_authority = seed_mint(&mut svm, USDC_MINT);
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    let student_ata = create_ata(&mut svm, &payer, &student.pubkey(), &USDC_MINT);
    mint_tokens_to(&mut svm, &payer, &USDC_MINT, &student_ata, &mint_authority, 50_000_000);
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_token(
            student.pubkey(),
            teacher.pubkey(),
            deadline,
            deadline,
            50_000_000,
            USDC_MINT,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .unwrap();

    // Deadline NOT passed — should fail.
    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::claim_task_failure_token(
            teacher.pubkey(),
            deadline,
            USDC_MINT,
        )],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ));
    assert!(
        result.is_err(),
        "token failure before deadline should be rejected"
    );
}
