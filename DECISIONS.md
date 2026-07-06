# DECISIONS

### Video

[![Demo ERC-7984 token video](https://img.youtube.com/vi/TrcFe_w8b6w/0.jpg)](https://www.youtube.com/watch?v=TrcFe_w8b6w)

### Tech

- **[Ponder](https://ponder.sh)** does the indexing. One dependency gives backfill, reorg handling, an embedded Postgres (PGlite), and an API layer (Hono). [Envio](https://envio.dev) was another option, but it's too big for a small demo project.
- **PGlite** by default. Zero extra setup.
- **Zama SDK** does all decryption. It's wrapped in one small module ([src/lib/decryptor.ts](src/lib/decryptor.ts)). The rest of the app only sees two outcomes: `DECRYPTED` or `RETRY`.
- **Local Anvil** for fast iteration: 1-second blocks, deterministic addresses, `cleartext()` relayer.
- There is also a sibling **[demo token repo](https://github.com/bakoushin/demo-erc7984-token)**. [`zama-ai/forge-fhevm`](https://github.com/zama-ai/forge-fhevm) provides the FHEVM host stack, but no token to index.

### Key choices

**Decryption is a lifecycle, not an ingestion step.** Every transfer is stored right away with `amount = null`. A sweep on each block then decrypts what the indexer is allowed to see and retries the rest. Why not decrypt during ingestion? Decryption needs a call to the relayer, and that call can fail. One slow call would make the whole indexer wait. With the sweep, no transfer is lost, and when a grant arrives later, the sweep fills in the old rows automatically.

**Delegations come from ACL contract events.** There is no polling. Revocation is an event, but expiry is not. So the expiration timestamp is stored and checked at read time (`expiration >= now`).

**Once decrypted, always shown.** Revoking a delegation stops future decryption. It doesn't erase history. The cleartext is already in the database, and deleting it would be fake privacy.

**Balance is read live from the chain** (`confidentialBalanceOf`) and decrypted on each request.

**The in-between states are explicit.** A transfer row is never an unclear `null`. It always has one of `DECRYPTED | PENDING | FAILED | NOT_ENTITLED`, so a wallet can show each state exactly.

**Throttling.** `RECONCILE_BATCH` limits the relayer calls per sweep. `RECONCILE_MAX_ATTEMPTS` stops a broken row from using up the batch again and again. A new grant resets the attempts, so no row is blocked forever.

## Reflection

### Weakest part under partner load

The balance check: `GET /v1/balance/:address`. Every request does a chain read plus a synchronous relayer decryption. There is no cache, no request coalescing, no rate limit.

Possible fix: the mapping `handle → cleartext` never changes, so it's safe to cache forever.

### What was left out

Performance work:

- The balance cache above
- Separate workers that decrypt old rows after a new permission
- Retries with backoff
- Observability

### SDK feedback

**One decrypt call instead of two.** The caller must pick the method: `decryptValues` when the signer itself may decrypt, `delegatedDecryptValues` when the access was delegated. The SDK already knows the signer address, so it could make that choice on its own, for example `decryptValues(inputs, { entitled })`. Because of this split, [decryptor.ts](src/lib/decryptor.ts) branches between the two calls.

### AI assistance

This project was built with Claude Code, in the usual AI-assisted way:

1. Decide the architecture and get agreement
2. Implement the plan (several iterations)
3. Review and fix the issues

**Correction example.** In the sweep query, two computed booleans (is `from`/`to` a delegator?) had no SQL aliases. Postgres then names both columns `?column?`. The row object keeps only one of the two keys. Ponder decodes rows by position, so the values silently moved: the entitlement flags went to the wrong fields, and no error appeared anywhere. In live runs it looked like delegated rows simply did not decrypt. The fix: explicit `.as('from_delegated')` and `.as('to_delegated')` aliases, plus a warning comment in [src/indexer/sweep.ts](src/indexer/sweep.ts).
