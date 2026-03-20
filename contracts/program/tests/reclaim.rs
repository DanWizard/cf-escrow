use cf_escrow_api::sdk;
use solana_sdk::{
    clock::Clock,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

mod helpers;
use helpers::*;

/// Deadline in the near past so we can easily warp past deadline + 1 week.
/// deadline = 100, reclaim window opens at 100 + 604_800 = 604_900.
const DEADLINE: i64 = 100;
const RECLAIM_SLOT: u64 = 604_901; // unix_timestamp = slot in litesvm warp_to_slot

fn warp_to_reclaim_window(svm: &mut litesvm::LiteSVM) {
    let mut clock: Clock = svm.get_sysvar();
    clock.slot += 1;
    clock.unix_timestamp = DEADLINE + 604_801; // one second past the grace period
    svm.set_sysvar(&clock);
}

// ─── SOL path ────────────────────────────────────────────────────────────────

/// Student can reclaim SOL after deadline + 1 week with no teacher action.
#[test]
fn test_reclaim_sol() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, DEADLINE);

    let stake = 500_000_000u64;
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_sol(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
            DEADLINE,
            stake,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .expect("accept_sol failed");

    let student_before = svm.get_balance(&student.pubkey()).unwrap();

    warp_to_reclaim_window(&mut svm);

    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::reclaim_sol(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .expect("reclaim_sol failed");

    // Student got stake back (plus rent from closed escrow).
    let student_after = svm.get_balance(&student.pubkey()).unwrap();
    assert!(
        student_after >= student_before + stake,
        "student should recover stake"
    );

    // Escrow is closed.
    assert_eq!(svm.get_balance(&escrow_addr).unwrap_or(0), 0);
}

/// Reclaim fails if the grace period hasn't elapsed yet.
#[test]
fn test_reclaim_sol_too_early_fails() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    create_escrow(&mut svm, &payer, &teacher, DEADLINE);
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_sol(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
            DEADLINE,
            100_000_000,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .unwrap();

    // Only advance past deadline, not past deadline + 1 week.
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = DEADLINE + 1;
    svm.set_sysvar(&clock);

    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::reclaim_sol(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ));
    assert!(result.is_err(), "reclaim before grace period should fail");
}

/// Teacher cannot call reclaim (wrong signer).
#[test]
fn test_reclaim_sol_teacher_cannot_call() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    create_escrow(&mut svm, &payer, &teacher, DEADLINE);
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_sol(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
            DEADLINE,
            100_000_000,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .unwrap();

    warp_to_reclaim_window(&mut svm);

    // Build reclaim ix but swap student for teacher as the signer.
    let mut bad_ix = sdk::reclaim_sol(student.pubkey(), teacher.pubkey(), DEADLINE);
    bad_ix.accounts[0].pubkey = teacher.pubkey();
    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[bad_ix],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ));
    assert!(result.is_err(), "teacher should not be able to reclaim");
}

/// Reclaim fails if the escrow was never accepted.
#[test]
fn test_reclaim_sol_not_accepted_fails() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    create_escrow(&mut svm, &payer, &teacher, DEADLINE);
    warp_to_reclaim_window(&mut svm);

    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::reclaim_sol(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ));
    assert!(result.is_err(), "reclaim on unaccepted escrow should fail");
}

/// Teacher settles as success before grace period — reclaim is no longer possible.
#[test]
fn test_reclaim_blocked_after_teacher_settles() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    create_escrow(&mut svm, &payer, &teacher, DEADLINE);
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_sol(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
            DEADLINE,
            100_000_000,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .unwrap();

    // Teacher settles immediately.
    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::claim_task_success_sol(
            teacher.pubkey(),
            student.pubkey(),
            DEADLINE,
        )],
        Some(&payer.pubkey()),
        &[&payer, &teacher],
        bh,
    ))
    .expect("claim_task_success_sol failed");

    // Now warp past the grace period and try to reclaim — escrow is already gone.
    warp_to_reclaim_window(&mut svm);

    let bh = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::reclaim_sol(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ));
    assert!(
        result.is_err(),
        "reclaim after settlement should fail — escrow doesn't exist"
    );
}

// ─── token path ──────────────────────────────────────────────────────────────

/// Student can reclaim tokens after deadline + 1 week.
#[test]
fn test_reclaim_token() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let mint_authority = seed_mint(&mut svm, USDC_MINT);
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000).unwrap();

    create_escrow(&mut svm, &payer, &teacher, DEADLINE);

    let student_ata = create_ata(&mut svm, &payer, &student.pubkey(), &USDC_MINT);
    let amount = 100_000_000u64;
    mint_tokens_to(&mut svm, &payer, &USDC_MINT, &student_ata, &mint_authority, amount);

    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_token(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
            DEADLINE,
            amount,
            USDC_MINT,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .expect("accept_token failed");

    warp_to_reclaim_window(&mut svm);

    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::reclaim_token(
            student.pubkey(),
            teacher.pubkey(),
            DEADLINE,
            USDC_MINT,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .expect("reclaim_token failed");

    // Student's ATA should be refunded.
    assert_eq!(
        read_token_account(&svm, &student_ata).amount,
        amount,
        "student should recover tokens"
    );
}
