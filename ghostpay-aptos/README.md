# GhostPay on Aptos

Privacy-preserving payment infrastructure rebuilt for Aptos Move. Deposit, transfer, and withdraw — invisibly.

Inspired by [ghostPay (Solana)](https://github.com/Jovian-Dsouza/ghostPay), rebuilt from scratch with an on-chain privacy pool, stealth addresses, multi-token support, and a dark glassmorphism UI.

## What's Different (vs. the Solana Version)

| Feature | Original (Solana) | GhostPay Aptos |
|---------|-------------------|----------------|
| Privacy layer | ShadowWire (external API) | On-chain Move privacy pool |
| Token support | USD1 only | APT, USDC, USDT (extensible) |
| Stealth addresses | None | On-chain registry + announcements |
| Transfer privacy | External mixing | Commitment-hash transfers (sender/recipient/amount hidden) |
| Fee mechanism | External | On-chain configurable (basis points) |
| Admin controls | None | Pause/unpause, fee updates, fee withdrawal |
| Anti-replay | None | Commitment store prevents double-spend |
| Design | White minimal | Dark glassmorphism with violet gradients |
| Wallet support | Phantom/Solflare/Backpack | Petra/Pontem/Martian |
| Chain | Solana | Aptos (Move) |

## Architecture

```
ghostpay-aptos/
├── move/                          # On-chain Move smart contracts
│   ├── Move.toml
│   └── sources/
│       ├── ghostpay.move          # Privacy pool: deposit, withdraw, private_transfer
│       └── stealth.move           # Stealth address registry & announcements
│
└── web/                           # React frontend (Vite + TypeScript + Tailwind)
    └── src/
        ├── components/            # Reusable UI components
        │   ├── AmountInput.tsx    # Calculator-style amount entry
        │   ├── BalanceCard.tsx    # Pool + on-chain balance display
        │   ├── BottomNav.tsx      # Tab navigation
        │   ├── ConnectWallet.tsx  # Multi-wallet connection screen
        │   ├── Layout.tsx         # App shell with header + nav
        │   ├── QRDisplay.tsx      # Aptos payment QR code generator
        │   ├── QRScanner.tsx      # Camera-based QR scanner
        │   └── TransactionList.tsx # Transaction history
        ├── config/
        │   └── aptos.ts           # Network, module addresses, polling config
        ├── contexts/
        │   └── WalletContext.tsx   # Aptos wallet adapter integration
        ├── hooks/
        │   ├── useBalance.ts      # Dual balance polling (pool + on-chain)
        │   └── usePayment.ts      # Payment session with timeout + verification
        ├── pages/
        │   ├── HomePage.tsx       # Dashboard with balance + actions + recent txs
        │   ├── DepositPage.tsx    # APT -> pool deposit
        │   ├── WithdrawPage.tsx   # Pool -> wallet withdrawal
        │   ├── SendPage.tsx       # QR scan -> private transfer
        │   ├── ReceivePage.tsx    # Generate QR -> wait for payment
        │   └── HistoryPage.tsx    # Full transaction history
        ├── services/
        │   ├── poolService.ts     # Contract interaction (view + entry functions)
        │   └── transactionStore.ts # LocalStorage transaction log
        ├── types/
        │   └── index.ts           # Token config, transaction types, helpers
        └── utils/
            └── parseError.ts      # Human-readable error mapping
```

## Move Smart Contracts

### `ghostpay::pool` — Privacy Pool

The core contract. Users deposit APT into a shared pool. Transfers within the pool record only a **commitment hash** on-chain — the sender, recipient, and amount remain private.

**Entry functions:**
- `initialize(deployer, fee_bps)` — Deploy the pool with a fee (in basis points)
- `deposit(account, pool_addr, amount)` — Deposit APT into the pool
- `withdraw(account, pool_addr, amount)` — Withdraw APT from the pool (minus fee)
- `private_transfer(sender, pool_addr, recipient, amount, commitment)` — Private transfer within the pool
- `set_fee(admin, pool_addr, new_fee_bps)` — Update fee (admin only)
- `set_paused(admin, pool_addr, paused)` — Pause/unpause (admin only)
- `withdraw_fees(admin, pool_addr)` — Collect accumulated fees (admin only)

**View functions:**
- `get_balance(user)` — User's pool balance
- `get_pool_stats(pool_addr)` — Total deposits, withdrawals, transfers, fee, paused state
- `is_commitment_used(pool_addr, commitment)` — Check if a commitment has been used

### `ghostpay::stealth` — Stealth Addresses

Optional module for enhanced privacy. Users register a stealth meta-address (public key pair). Senders derive a one-time stealth address for each payment, so the recipient's real address never appears in the payment graph.

**Entry functions:**
- `initialize_registry(deployer)` — Deploy the stealth registry
- `register(account, registry_addr, spending_pubkey, viewing_pubkey)` — Register stealth keys
- `announce(sender, registry_addr, ephemeral_pubkey, stealth_address, metadata)` — Publish payment announcement

**View functions:**
- `get_meta_address(user)` — Look up stealth public keys
- `is_registered(user)` — Check registration status
- `get_announcement_count(registry_addr)` — Number of announcements

## How Privacy Works

1. **Deposit**: User sends APT to the pool contract. Their pool balance is updated in module storage. On-chain, this looks like a normal transfer to the pool address.

2. **Private Transfer**: Sender generates a commitment hash = `SHA-256(sender || recipient || amount || nonce)`. The contract debits the sender and credits the recipient, but the on-chain event only contains the commitment hash — no sender, recipient, or amount.

3. **Withdrawal**: User withdraws from their pool balance back to their wallet. A fee (configurable basis points) is deducted.

4. **Verification**: Both parties can independently compute the commitment hash to verify the transfer occurred, without revealing it publicly.

## Development

### Prerequisites

- [Aptos CLI](https://aptos.dev/tools/aptos-cli/) (for contract deployment)
- Node.js >= 18
- pnpm or npm

### Move Contracts

```bash
cd ghostpay-aptos/move

# Compile
aptos move compile --named-addresses ghostpay=default

# Test
aptos move test --named-addresses ghostpay=default

# Deploy to testnet
aptos move publish --named-addresses ghostpay=default --network testnet
```

### Web App

```bash
cd ghostpay-aptos/web

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your VITE_GHOSTPAY_ADDRESS and VITE_APTOS_API_KEY

# Development
npm run dev

# Production build
npm run build
```

### Environment Variables

```bash
VITE_GHOSTPAY_ADDRESS=0x...   # Deployed contract address
VITE_APTOS_API_KEY=...        # Optional: Aptos API key for higher rate limits
```

## License

MIT
