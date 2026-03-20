# contracts

Solana on-chain program for cf-escrow, built with the [Steel](https://github.com/regolith-labs/steel) framework.

## Directory structure

```
contracts/
├── api/                  # Public crate (imported by clients and tests)
│   └── src/
│       ├── lib.rs        # Crate root; re-exports + program ID constant
│       ├── consts.rs     # Shared constants (allowed mint addresses, sizes)
│       ├── error.rs      # CfEscrowError enum
│       ├── instruction.rs# Instruction discriminants + data structs
│       ├── sdk.rs        # Instruction builder functions (used by frontend + tests)
│       └── state/
│           ├── mod.rs
│           └── escrow.rs # Escrow account struct (128 bytes)
└── program/              # Executable BPF program
    ├── src/
    │   ├── lib.rs              # Entrypoint + instruction dispatch
    │   ├── create.rs           # Create handler
    │   ├── cancel.rs           # Cancel handler
    │   ├── accept.rs           # Accept handler (SOL + token paths)
    │   ├── claim_task_success.rs
    │   ├── claim_task_failure.rs
    │   └── reclaim.rs
    └── tests/
        ├── helpers/mod.rs      # LiteSVM setup, mint helpers
        ├── create.rs
        ├── cancel.rs
        ├── accept.rs
        ├── claim_task_success.rs
        ├── claim_task_failure.rs
        └── reclaim.rs
```

## API crate

### `state/escrow.rs` — Escrow account (128 bytes)

```rust
pub struct Escrow {
    pub provider:  Pubkey,   // teacher who created the escrow
    pub client:    Pubkey,   // student who accepted; default = not yet accepted
    pub mint:      Pubkey,   // SPL token mint; default = SOL
    pub amount:    u64,      // staked amount
    pub deadline:  i64,      // unix timestamp; set by student at accept time
    pub bump:      u64,
}
```

PDA seeds: `["escrow", provider_pubkey, deadline_le_bytes]`
The provider supplies a far-future sentinel as the PDA seed; the real deadline is written by the student during `Accept`.

### `instruction.rs` — Instruction data structs

```rust
pub struct Create          { pub deadline: i64 }                   // 9 bytes
pub struct Cancel          {}                                       // 1 byte
pub struct Accept          { pub amount: u64, pub mint: Pubkey,
                             pub deadline: i64 }                   // 49 bytes
pub struct ClaimTaskSuccess{}                                       // 1 byte
pub struct ClaimTaskFailure{}                                       // 1 byte
pub struct Reclaim         {}                                       // 1 byte
```

### `sdk.rs` — Instruction builders

| Function | Description |
|---|---|
| `create(provider, deadline)` | Build `Create` instruction |
| `cancel(provider, deadline)` | Build `Cancel` instruction |
| `accept_sol(student, provider, pda_deadline, client_deadline, amount)` | Build `Accept` for SOL |
| `accept_token(student, provider, pda_deadline, client_deadline, amount, mint)` | Build `Accept` for SPL token |
| `claim_task_success_sol(teacher, student, deadline)` | Build `ClaimTaskSuccess` for SOL |
| `claim_task_success_token(teacher, student, deadline, mint)` | Build `ClaimTaskSuccess` for token |
| `claim_task_failure_sol(teacher, deadline)` | Build `ClaimTaskFailure` for SOL |
| `claim_task_failure_token(teacher, deadline, mint)` | Build `ClaimTaskFailure` for token |
| `reclaim_sol(student, provider, deadline)` | Build `Reclaim` for SOL |
| `reclaim_token(student, provider, deadline, mint)` | Build `Reclaim` for token |

`pda_deadline` = the sentinel deadline used as the PDA seed (from the `Create` call).
`client_deadline` = the real task deadline written into the escrow during `Accept`.

## Program handlers

### `create.rs`
Validates the deadline is in the future, then allocates the escrow PDA and sets `provider`, `deadline` (sentinel), and `bump`. `client` and `mint` default to `Pubkey::default()`.

### `cancel.rs`
Checks `client == Pubkey::default()` (not accepted), then closes the escrow and returns rent to the provider.

### `accept.rs`
- Validates `client == Pubkey::default()` (not yet taken) and `now < deadline`.
- For SOL: transfers lamports from student to escrow via system program.
- For token: transfers via SPL token CPI from student ATA → escrow ATA (creating escrow ATA if needed).
- Writes `client`, `amount`, `mint`, and `deadline` (client-supplied real deadline) onto the escrow.

### `claim_task_success.rs`
- Provider signer, callable any time after accept.
- Returns stake to student (SOL transfer or token CPI), then closes escrow (rent → provider).

### `claim_task_failure.rs`
- Provider signer, requires `now > deadline`.
- Sends stake to provider (SOL transfer or token CPI to provider's ATA), then closes escrow.

### `reclaim.rs`
- Student signer, requires `now > deadline + 604_800` (1 week grace period).
- Returns stake to student, closes escrow.

## Tests

Integration tests use [LiteSVM](https://github.com/LiteSVM/litesvm) — an in-process Solana SVM for fast testing without a local validator.

```bash
# Run all tests
steel test
# or
cargo test-sbf
```

## Deploy

```bash
./deploy.sh devnet
./deploy.sh mainnet
```

After deploying, update `PROGRAM_ID` in `frontend/js/config.js` and `api/src/lib.rs`.
