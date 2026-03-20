use cf_escrow_api::{prelude::*, sdk};
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use steel::Pubkey;

mod helpers;
use helpers::*;

fn future_deadline() -> i64 {
    4_070_908_800 // 2099-01-01
}

// ─── SOL ──────────────────────────────────────────────────────────────────────

#[test]
fn test_accept_escrow_sol() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, deadline);

    let student = Keypair::new();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let stake = 500_000_000u64;
    let ix = sdk::accept_sol(student.pubkey(), teacher.pubkey(), deadline, deadline, stake);
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &student],
        blockhash,
    ))
    .expect("accept_sol should succeed");

    let escrow = read_escrow(&svm, &escrow_addr);
    assert_eq!(escrow.client, student.pubkey(), "client not set");
    assert_eq!(
        escrow.mint,
        Pubkey::default(),
        "mint should stay default for SOL"
    );
    assert_eq!(escrow.amount, stake, "amount mismatch");
    assert_eq!(escrow.provider, teacher.pubkey(), "provider mismatch");

    let escrow_lamports = svm.get_account(&escrow_addr).unwrap().lamports;
    assert!(escrow_lamports >= stake, "escrow lamports too low");
}

#[test]
fn test_accept_escrow_sol_twice_fails() {
    let (mut svm, payer) = setup();

    let teacher = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    let student = Keypair::new();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();

    let stake = 100_000_000u64;
    let ix = sdk::accept_sol(student.pubkey(), teacher.pubkey(), deadline, deadline, stake);
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix.clone()],
        Some(&payer.pubkey()),
        &[&payer, &student],
        blockhash,
    ))
    .expect("first accept should succeed");

    let student2 = Keypair::new();
    svm.airdrop(&student2.pubkey(), 5_000_000_000).unwrap();
    let ix2 = sdk::accept_sol(student2.pubkey(), teacher.pubkey(), deadline, deadline, stake);
    let blockhash = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix2],
        Some(&payer.pubkey()),
        &[&payer, &student2],
        blockhash,
    ));
    assert!(result.is_err(), "double accept should fail");
}

// ─── Token (cfUSDC) ───────────────────────────────────────────────────────────

#[test]
fn test_accept_escrow_usdc() {
    let (mut svm, payer) = setup();

    let mint_authority = seed_mint(&mut svm, USDC_MINT);

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000)
        .unwrap();

    let deadline = future_deadline();
    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, deadline);

    let student_ata = create_ata(&mut svm, &payer, &student.pubkey(), &USDC_MINT);
    let amount = 100_000_000u64; // 100 USDC (6 decimals)
    mint_tokens_to(
        &mut svm,
        &payer,
        &USDC_MINT,
        &student_ata,
        &mint_authority,
        amount,
    );

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
    .expect("accept_token (USDC) should succeed");

    let escrow = read_escrow(&svm, &escrow_addr);
    assert_eq!(escrow.client, student.pubkey(), "client not set");
    assert_eq!(escrow.mint, USDC_MINT, "mint mismatch");
    assert_eq!(escrow.amount, amount, "amount mismatch");

    let escrow_ata =
        spl_associated_token_account::get_associated_token_address(&escrow_addr, &USDC_MINT);
    assert_eq!(
        read_token_account(&svm, &escrow_ata).amount,
        amount,
        "escrow ATA wrong"
    );
    assert_eq!(
        read_token_account(&svm, &student_ata).amount,
        0,
        "student ATA not drained"
    );
}

// ─── Token (cfUSDT) ───────────────────────────────────────────────────────────

#[test]
fn test_accept_escrow_usdt() {
    let (mut svm, payer) = setup();

    let mint_authority = seed_mint(&mut svm, USDT_MINT);

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000)
        .unwrap();

    let deadline = future_deadline();
    let escrow_addr = create_escrow(&mut svm, &payer, &teacher, deadline);

    let student_ata = create_ata(&mut svm, &payer, &student.pubkey(), &USDT_MINT);
    let amount = 50_000_000u64; // 50 USDT
    mint_tokens_to(
        &mut svm,
        &payer,
        &USDT_MINT,
        &student_ata,
        &mint_authority,
        amount,
    );

    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_token(
            student.pubkey(),
            teacher.pubkey(),
            deadline,
            deadline,
            amount,
            USDT_MINT,
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .expect("accept_token (USDT) should succeed");

    let escrow = read_escrow(&svm, &escrow_addr);
    assert_eq!(escrow.mint, USDT_MINT, "mint mismatch");
    assert_eq!(escrow.amount, amount, "amount mismatch");
}

// ─── Arbitrary token ──────────────────────────────────────────────────────────

/// The contract accepts ANY SPL token — there is no mint whitelist.
#[test]
fn test_accept_escrow_arbitrary_token() {
    let (mut svm, payer) = setup();

    let arbitrary_mint = Keypair::new();
    let mint_authority = seed_mint(&mut svm, arbitrary_mint.pubkey());

    let teacher = Keypair::new();
    let student = Keypair::new();
    svm.airdrop(&teacher.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&student.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000)
        .unwrap();

    let deadline = future_deadline();
    create_escrow(&mut svm, &payer, &teacher, deadline);

    let student_ata = create_ata(
        &mut svm,
        &payer,
        &student.pubkey(),
        &arbitrary_mint.pubkey(),
    );
    let amount = 1_000_000u64;
    mint_tokens_to(
        &mut svm,
        &payer,
        &arbitrary_mint.pubkey(),
        &student_ata,
        &mint_authority,
        amount,
    );

    let bh = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[sdk::accept_token(
            student.pubkey(),
            teacher.pubkey(),
            deadline,
            deadline,
            amount,
            arbitrary_mint.pubkey(),
        )],
        Some(&payer.pubkey()),
        &[&payer, &student],
        bh,
    ))
    .expect("accept with arbitrary SPL token should succeed — no whitelist");
}
