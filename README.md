# cf-escrow

A Solana commitment escrow program for teacher/student accountability. A teacher (provider) creates an escrow with a deadline; a student (client) stakes SOL or SPL tokens against completing a task by that deadline. The teacher then settles the outcome — returning the stake on success or keeping it on failure. If the teacher never settles, the student can reclaim their stake after a one-week grace period past the deadline.

## Repository structure

```
cf-escrow/
├── contracts/          # On-chain Solana program (Rust, Steel framework)
│   ├── api/            # Public crate: types, errors, SDK instruction builders
│   └── program/        # Executable BPF program + integration tests
├── frontend/           # Vanilla JS SPA (no build step)
│   ├── index.html      # App shell — single entry point
│   ├── provider/       # index.html redirect for hard-refresh on /provider
│   ├── js/
│   │   ├── app.js          # SPA route handlers (provider, client, accept)
│   │   ├── router.js       # Client-side router (History API)
│   │   ├── config.js       # Program ID, RPC URL, mint addresses
│   │   ├── services/
│   │   │   ├── chain.js                # RPC fetching + escrow account parsing
│   │   │   ├── wallet.js               # Phantom wallet connect/disconnect
│   │   │   ├── transactions.js         # Provider instruction builders
│   │   │   ├── client-transactions.js  # Accept instruction builder
│   │   │   ├── student-transactions.js # ClaimSuccess/Failure/Reclaim builders
│   │   │   └── storage.js              # localStorage tracking for closed escrows
│   │   ├── components/
│   │   │   ├── wallet-header.js  # Header web component (nav + wallet dropdown)
│   │   │   ├── escrow-card.js    # Single escrow card web component
│   │   │   ├── escrow-list.js    # Escrow list web component
│   │   │   ├── create-modal.js   # Create-escrow modal web component
│   │   │   └── toast-manager.js  # Toast notification web component
│   │   └── utils/
│   │       ├── format.js    # Display helpers (truncate, dates, amounts)
│   │       └── serialize.js # Manual instruction serialization
│   └── css/
│       └── main.css     # All styles
└── test-tokens/        # Devnet test mint program (cfUSDC + cfUSDT)
    ├── program/        # On-chain Rust program (Steel framework)
    ├── api/            # Rust crate: PDAs, instruction builders
    └── scripts/        # JS scripts: deploy, initialize, fund, mint
```

---

## On-chain program

**Program ID:** `pVdMMWMsvHDGjdzXwHPTCBR2HqfrWxqqFSN4XeR3qLJ`
**Network:** Solana Devnet
**Framework:** [Steel](https://github.com/regolith-labs/steel)

### Escrow account layout (128 bytes)

| Offset  | Field         | Type    | Notes                         |
|---------|---------------|---------|-------------------------------|
| 0–8     | discriminator | u64     | Steel account tag             |
| 8–40    | provider      | Pubkey  | Teacher who created the escrow |
| 40–72   | client        | Pubkey  | Student who accepted; default pubkey = not yet accepted |
| 72–104  | mint          | Pubkey  | SPL token mint; default pubkey = SOL |
| 104–112 | amount        | u64 LE  | Staked amount (lamports or token raw units) |
| 112–120 | deadline      | i64 LE  | Unix timestamp set by student at accept time |
| 120–128 | bump          | u64 LE  | PDA bump stored for convenience |

**PDA seeds:** `["escrow", provider_pubkey, deadline_le_bytes]`

The provider supplies a far-future sentinel deadline when calling `Create` — this becomes the PDA seed. The student sets the real task deadline inside the `Accept` instruction payload, which is written into the `deadline` field on-chain.

### Instructions

| # | Name              | Signer   | When callable           | Effect |
|---|-------------------|----------|-------------------------|--------|
| 0 | `Create`          | Provider | Any time                | Allocates escrow PDA with sentinel deadline as seed |
| 1 | `Cancel`          | Provider | Before student accepts  | Closes escrow and returns rent to provider |
| 2 | `Accept`          | Student  | Before deadline         | Stakes SOL or SPL token; sets real deadline on escrow |
| 3 | `ClaimTaskFailure`| Provider | After deadline          | Provider keeps stake; closes escrow |
| 4 | `ClaimTaskSuccess`| Provider | After accept            | Stake returned to student; closes escrow |
| 5 | `Reclaim`         | Student  | After deadline + 1 week | Student reclaims stake if provider never settled |

### Instruction data layouts

**Create** (9 bytes): `[discriminator u8] [deadline i64 LE]`

**Accept** (49 bytes): `[discriminator u8] [amount u64 LE] [mint Pubkey 32B] [deadline i64 LE]`
- `mint` is `Pubkey::default()` for SOL
- `deadline` is the real task deadline (written into escrow)

**Cancel / ClaimTaskSuccess / ClaimTaskFailure / Reclaim** (1 byte): `[discriminator u8]`

### Error codes

| Code | Name                  | Meaning |
|------|-----------------------|---------|
| 0    | AlreadyAccepted       | Escrow already has a student |
| 1    | DeadlinePassed        | Can't accept after deadline |
| 2    | InvalidMint           | Token not on allowlist |
| 3    | NotAccepted           | No student has staked yet |
| 4    | DeadlineNotPassed     | ClaimFailure called before deadline |
| 5    | Unauthorized          | Signer is not the expected party |
| 6    | InvalidDeadline       | Deadline must be in the future |
| 7    | ReclaimWindowNotOpen  | Deadline + 1 week hasn't elapsed |

---

## Frontend

Vanilla JS ES modules, no bundler. Served as static files — works with any file server or deployment platform.

### Routes

| URL                  | View     | Description |
|----------------------|----------|-------------|
| `/`                  | Client   | Browse and accept open escrows (student view) |
| `/provider`          | Provider | Create/cancel escrows, settle outcomes (teacher view) |
| `/?escrow=<PDA>`     | Accept   | Stake into a specific escrow by PDA address |

Routing uses the History API (`pushState`/`replaceState`). Hard refresh at `/provider` is handled by `provider/index.html` — a minimal redirect page that any file server will serve as a directory index.

### Deployment

The `_redirects` (Netlify), `vercel.json` (Vercel), and `.htaccess` (Apache) files in `frontend/` all redirect every path to `index.html` for SPA support.

For local dev, any server that supports directory indexes works (e.g. `npx serve frontend`).

### Tokens (devnet)

| Symbol | Address |
|--------|---------|
| cfUSDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| cfUSDT | *(see `frontend/js/config.js`)* |

*(Mainnet: standard USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`)*

---

## Test tokens (devnet only)

`test-tokens/` is a standalone Solana program that creates two SPL mints — **cfUSDC** and **cfUSDT** — and lets the deploy authority mint arbitrary amounts to any wallet.

### PDAs

| Seed            | Account |
|-----------------|---------|
| `"config"`      | Stores authority + mint addresses |
| `"mint_authority"` | Signs all `mint_to` CPI calls |
| `"cfUSDC"`      | cfUSDC mint |
| `"cfUSDT"`      | cfUSDT mint |

### Setup

```bash
# 1. Deploy (run once)
cd test-tokens
./deploy.sh            # devnet (default)
./deploy.sh localnet

# 2. Install JS dependencies
cd scripts && npm install

# 3. Initialize mints (run once per deployment)
node initialize.js
# → prints mint addresses; copy into frontend/js/config.js
```

### Minting

```bash
# Fund id wallet + optional student wallet with 10,000 of each token
node fund.js
node fund.js <student-pubkey>
node fund.js <student-pubkey> 5000   # custom amount

# Mint a single token to any wallet
node mint.js <recipient-pubkey> <amount> [usdc|usdt]
```

Amounts are in human units (e.g. `1000` = 1,000.000000 tokens, 6 decimals). ATAs are created automatically.

---

## Building & testing

```bash
# Build the program
cd contracts
steel build

# Run integration tests (LiteSVM)
steel test
# or: cargo test-sbf

# Deploy to devnet
./deploy.sh devnet
```

After deploying, copy the new **Program ID** into `frontend/js/config.js` (`PROGRAM_ID`).
