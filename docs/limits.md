# Limits

What Concord deliberately does not do, and where it stops. The README links here.

Which of these are next to fall, and what never will, is in
[`docs/ROADMAP.md`](./ROADMAP.md).

- **History.** Stellar RPC keeps about seven days of events. A classic asset is therefore
  watched from opening balances: every trustline's balance from Horizon, then events from that
  ledger on. Horizon does not list balances held by liquidity pools, claimable balances or
  contracts, so opening balances understate supply by whatever those hold. Holdings before the
  opening balances cannot be queried. For full architecture, retention rules, and timeline diagrams, see
  [`docs/history-and-baselines.md`](./history-and-baselines.md).
- **Contract tokens.** A SEP-41 token that is not the contract of a classic asset has no opening
  balances to read, so its holdings count only movements from the oldest ledger the RPC keeps.
  The dashboard says so on every page of such an asset. Tokens that do not emit the standard
  `set_authorized` and `clawback` events will show an empty controls log.
- **Gaps.** If the indexer is down for longer than RPC retention, the events in between are
  lost. Concord detects this, stops indexing the asset and says why; **Rebuild history** in the
  asset's settings starts it again from fresh opening balances and keeps the uploaded books. See
  [`docs/troubleshooting.md`](./troubleshooting.md) for every sync and indexing message explained.
- **Decimals.** Classic assets carry seven. A contract token's are read from the contract; one
  that does not state them has to be told when it is watched.
- **Email.** None is sent. Addresses are not verified at sign-up, invitations travel by link, and
  password resets go through the operator. See [`docs/adr/0003-no-email.md`](./adr/0003-no-email.md) for the
  architectural decision and threat model.
- **Scale.** One process, one SQLite file per workspace, holdings replayed from events in
  memory. It has run an asset with a thousand holders and seven thousand events comfortably; it
  has not been load-tested beyond that.
- **Splits.** Fractions of the smallest unit are dropped; cash in lieu is not modelled.
