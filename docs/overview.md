# Overview

What Concord does, what it flags, why now, who it is for and where it sits among related projects.
The README links here.

## What it does

| Module | Job |
|---|---|
| Indexer | Read CAP-67 events for a watched set of regulated assets (classic and SEP-41) |
| Reconciler | Match on-chain holdings and movements against each register export as it is imported, and on demand; flag breaks |
| Corporate actions | Record-date snapshots; dividend, split and redemption reconciliation — see [`docs/corporate-actions.md`](./corporate-actions.md) |
| Controls log | Every freeze, authorisation change and clawback, tied to the instruction that caused it |
| Audit export | Regulator- and auditor-ready reports |

Read-only. Concord never holds keys or moves money. The reasoning, the one exception (the testnet
practice script), and the rules for proposals that would add signing are in
[`docs/adr/0004-read-only.md`](./adr/0004-read-only.md).

## What it flags

- **Positions:** quantity mismatch, holder on chain but not on the register, holder on the
  register but not on chain, register holder with no address, frozen/active disagreement, total
  supply mismatch.
- **Movements** (when a journal is loaded): on-chain movement missing from the journal, journal
  entry with no ledger event, entry whose cited transaction moved a different amount.
- **Corporate actions:** per holder, entitlement at the record time against what the ledger
  showed in the execution window: missing, short, excess, or paid to someone not entitled. An
  action recorded ahead of its record time is reconciled by itself once the chain passes it.
- **Controls:** a freeze, authorisation or clawback with no instruction issued in the 72 hours
  before it, and an instruction that was never executed.

A break can be acknowledged or resolved with a note. The sign-off holds only while the figures it
was written against are unchanged; if the break moves, it reopens. See
[`docs/signoff.md`](./signoff.md) for what a note is attached to, what the fingerprint captures
per scope, and when a sign-off goes stale, and [`docs/breaks.md`](./breaks.md) for the complete
break-type glossary, root causes and investigation steps.

A reconciliation runs when a register is imported and whenever someone re-runs it. Nothing
reconciles on a timer: a new day's comparison needs that day's register. See
[`docs/reconciliation.md`](./reconciliation.md) for event replay mechanics, omnibus aggregation,
movement matching rules, and a worked numeric example producing every break type.

## Why now

- DTCC's tokenization service plans to connect to Stellar in **H1 2027**. First assets: Russell
  1000 stocks, major index ETFs, US Treasuries (DTCC press release, 2026-05-27).
- Stellar already holds about **$4B** of tokenized RWAs (SDF Dune dashboard, 2026-08-29). Spiko,
  Franklin Templeton (BENJI), Ondo and WisdomTree all keep official registers alongside the chain.
- CAP-67 (Final, Protocol 23) makes classic Stellar operations emit `transfer`, `mint`, `burn`,
  `clawback` and `set_authorized` events in the same format as Soroban. For the first time,
  regulated-asset activity can be indexed without decoding every operation type by hand.

## Who buys it

Transfer agents, custodians and fund administrators serving issuers on Stellar. Priced as
software: per asset and per seat.

## Relationship to other projects

Concord is a stand-alone company. It was split from the Ballast idea set on 2026-09-16 because
it shares no buyer, balance sheet or regulatory load with Ballast. See
`../ballast/README.md` for the reasoning.