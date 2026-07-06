# Zama ERC-7984 Confidential Indexer

A [Ponder](https://ponder.sh) indexer with a REST API. It indexes a confidential (ERC-7984) token on [Zama FHEVM](https://docs.zama.ai/protocol). Balances and transfer amounts of this token are encrypted on-chain. The indexer decrypts what it is allowed to see. Then it serves the data over HTTP.

### Video overview

[![Demo ERC-7984 token video](https://img.youtube.com/vi/TrcFe_w8b6w/0.jpg)](https://www.youtube.com/watch?v=TrcFe_w8b6w)

## How it works

- The indexer reads `ConfidentialTransfer` events from the token, plus delegation events (`DelegatedForUserDecryption`, `RevokedDelegationForUserDecryption`) from the shared FHEVM ACL contract.
- The Zama SDK decrypts the transfer amounts. This works when the indexer is the sender or the receiver of a transfer. It also works when a user gave the indexer the right to decrypt for them.
- A background job (the "reconcile sweep") runs on every block. It retries failed decryptions and updates the heartbeat for `/v1/health`.
- Decrypted amounts stay in the database, even if the user revokes the delegation later. Transfers that the indexer can't decrypt stay encrypted. The API returns them as `NOT_ENTITLED`.

## Motivation

See [DECISIONS.md](DECISIONS.md)

## What you need

- Node.js 22 or newer
- [Foundry](https://getfoundry.sh) (`anvil`, `forge`)
- Two repos next to this one:
  - `../demo-erc7984-token`: the [demo ERC-7984 token](https://github.com/bakoushin/demo-erc7984-token)
  - `../forge-fhevm`: local FHEVM host stack ([zama-ai/forge-fhevm](https://github.com/zama-ai/forge-fhevm)). Install its dependencies with `forge soldeer install`.

## Local setup (Anvil + demo token)

**1. Start Anvil** in its own terminal:

```bash
anvil --block-time 1
```

`--block-time 1` is important. The reconcile sweep and the health heartbeat run on every new block. Without this flag, Anvil creates a block only when a transaction arrives, so the sweep and the heartbeat almost never run.

**2. Deploy the FHEVM host stack** (once per Anvil run):

```bash
cd ../forge-fhevm && ./deploy-local.sh
```

This deploys the ACL and the other contracts at the addresses that the Zama SDK expects on a local Anvil (ACL: `0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D`).

**3. Deploy the demo token:**

```bash
cd ../demo-erc7984-token && ./demo.sh deploy
```

The script prints the token address (`ConfidentialToken: 0x…`). The address is always the same, because the script uses CREATE2 with a fixed salt. After every Anvil restart you get: `0x484e39c4e89280a2bae7126ec14e39e3d8801ce2`.

**4. Configure and start the indexer** (in this repo):

```bash
npm install
```

Create `.env.local` from the example:

```bash
cp .env.example .env.local
```

The private key must be the key of Anvil account #3 (`0x90F79bf6…b906`). The demo script hardcodes this address as the decryption delegate. If you use another key, the indexer never receives a delegation, so it can't decrypt anything.

```bash
npm run dev
```

The API runs at `http://localhost:42069`. The indexer also reads old logs, starting from block 0, so the order of steps 3 and 4 doesn't matter.

**5. Generate activity** (from `../demo-erc7984-token`):

```bash
./demo.sh delegate       # holder delegates decryption to the indexer
./demo.sh mint 1000      # owner mints 1000 to the holder
./demo.sh transfer 400   # holder transfers 400 to the recipient
# or all at once: ./demo.sh all
```

Then query the API (the holder is Anvil account #1):

```bash
curl http://localhost:42069/v1/balance/0x70997970C51812dc3A010C7d01b50e0d17dc79C8
curl http://localhost:42069/v1/transfers/0x70997970C51812dc3A010C7d01b50e0d17dc79C8
curl http://localhost:42069/v1/health
```

See [example.http](example.http) for more request examples.

## API

All endpoints are `GET`. No authentication. Bigint values are returned as strings.

| Endpoint                 | What it does                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/balance/:address`   | Current balance. `status` is `DECRYPTED` or `NOT_ENTITLED`. Returns 503 if decryption is not available right now.                                                                                           |
| `/v1/transfers/:address` | Transfer history (`from` or `to` = address), newest first. `?limit=` (1–200, default 50) and `?cursor=` for keyset pagination. Each row has a `status`: `DECRYPTED`, `PENDING`, `FAILED` or `NOT_ENTITLED`. |
| `/v1/token`              | Token metadata: `address`, `name`, `symbol`, `decimals`.                                                                                                                                                    |
| `/v1/health`             | Indexing lag vs the chain head. 200 when `lag <= HEALTH_LAG_THRESHOLD`, 503 otherwise.                                                                                                                      |

## Configuration

Environment variables (validated in [src/lib/env.ts](src/lib/env.ts)):

| Variable                   | Default                 | What it is                                                   |
| -------------------------- | ----------------------- | ------------------------------------------------------------ |
| `TOKEN_ADDRESS`            | — (required)            | Address of the confidential token to index                   |
| `INDEXER_PRIVATE_KEY`      | — (required)            | Key of the indexer identity, used for (delegated) decryption |
| `RPC_URL`                  | `http://127.0.0.1:8545` | JSON-RPC endpoint                                            |
| `CHAIN_ID`                 | `31337`                 | `31337` (Anvil) or `11155111` (Sepolia)                      |
| `START_BLOCK`              | `0`                     | First block to index                                         |
| `RECONCILE_BLOCK_INTERVAL` | `1`                     | Blocks between reconcile sweeps                              |
| `RECONCILE_BATCH`          | `25`                    | Max rows retried per sweep                                   |
| `RECONCILE_MAX_ATTEMPTS`   | `25`                    | Attempts before a row is marked `FAILED`                     |
| `HEALTH_LAG_THRESHOLD`     | `25`                    | Max allowed lag (in blocks) for `/v1/health`                 |

Storage: Ponder's embedded PGlite under `.ponder/` by default. Set `DATABASE_URL` to use Postgres. Postgres is required for `npm run serve` (the API-only mode).

## Scripts

| Command             | What it does                                                                   |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`       | Indexer + API with hot reload                                                  |
| `npm start`         | Production indexer + API                                                       |
| `npm run serve`     | API only (needs Postgres)                                                      |
| `npm test`          | Vitest suite. Runs fully in-process (PGlite + mocked relayer), no Anvil needed |
| `npm run typecheck` | `tsc --noEmit`                                                                 |
