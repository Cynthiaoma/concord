# Concord

Reconciliation between tokenized securities on Stellar and the official books kept by transfer
agents, custodians and fund administrators.

When a security lives both on-chain and in a register, someone has to prove the two agree, every
day. Dividends, splits, freezes and clawbacks have to land on both sides. Today that work is
manual. Concord does it from ledger events.

**Status:** working, and ready to put in front of people. The indexer, reconciler,
corporate-actions engine, controls log and audit export run end to end behind sign-in, with a
private workspace per organisation. It has been exercised against Stellar mainnet: watching
Franklin Templeton's BENJI, Concord's unit total matched Horizon's own figure to the last decimal,
and a register built from the chain's holdings reconciled clean across all 1,005 positions (see
reproduction steps in [`docs/evidence/benji-mainnet.md`](./docs/evidence/benji-mainnet.md)). No
customer has used it. The product brief and kill criteria are in [`BRIEF.md`](./BRIEF.md).
Questions, bug reports and what to expect back: [`SUPPORT.md`](./SUPPORT.md). Answers to common questions are in [`docs/FAQ.md`](./docs/FAQ.md).

What it does, what it flags, why now and who it is for: [`docs/overview.md`](./docs/overview.md).
What it deliberately does not do: [`docs/limits.md`](./docs/limits.md).

## Run it

Needs Node 24+ and pnpm 10.22 (pinned in `package.json`). Nothing else: storage is SQLite through `node:sqlite`.

```sh
pnpm install
pnpm build
pnpm start            # API and dashboard on http://127.0.0.1:4400
```

Open the address, create a workspace, and watch an asset. Mainnet and testnet are both served;
the switch is at the top left. A new workspace is empty. Concord ships no sample data: the chain
side comes from the ledger, and the register side is the file you upload. The
[dashboard user guide](./docs/user-guide.md) walks through each tab.

`pnpm test` runs the unit and service tests. `pnpm dev` runs the API and the dashboard with reload.

Configuration is by environment variable, or a `.env` file beside `package.json`; see
[`.env.example`](./.env.example) and [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md) for every
variable. With nothing set, mainnet uses free public RPC endpoints, which suit light use; point
`CONCORD_MAINNET_RPC_URLS` at a provider for anything more. Where the databases live and what is
safe to delete: [`docs/data-directory.md`](./docs/data-directory.md). What personal data is
stored and how to remove it: [`docs/privacy.md`](./docs/privacy.md).

## Accounts and workspaces

A **workspace** holds the assets an organisation watches and the books it uploads, in a SQLite
file of its own ([why](./docs/adr/0001-sqlite-per-tenant.md), [isolation](./docs/tenancy.md)). People
sign in with email and password, or with Google ([setup](./docs/google-signin.md)); Concord sends no
email, so invitations travel by link. **Owners** manage people and assets, **Members** do the rest
([roles](./docs/roles.md)). `CONCORD_SIGNUP=open` lets anyone create a workspace, `CONCORD_SIGNUP=code`
needs a code from `pnpm concord signup-code`; see the [operator guide](./docs/operator-guide.md).

## Command line

Everything on the dashboard except sign-off and team management is also on the command line. It
works on the same data directory as the server, and may run while the server does.

```sh
pnpm concord orgs
export CONCORD_ORG="Harbourline Transfer"     # or pass --org to each command
pnpm concord watch FUND:GISSUER... --name "Example Fund" --ignore GTREASURY...
pnpm concord register FUND ./register.csv --as-of 2026-10-06T21:00:00Z
pnpm concord action FUND split --record 2026-10-01T21:00:00Z --ratio 2:1
pnpm concord export FUND --out audit.json
pnpm concord --help
```

Every command, option and exit code (journal, instructions, dividends, controls, backup and the
rest) is in the [command-line reference](./docs/cli.md). The audit pack format is in
[`docs/audit-pack.md`](./docs/audit-pack.md).

## Input files

All CSV with a header row. Amounts are decimals in whole units; more precision than the asset
carries is rejected, not rounded (see [`docs/adr/0002-bigint-amounts.md`](./docs/adr/0002-bigint-amounts.md)).
Rows that cannot be read are listed with their line number and
the reason, and the rest of the file is loaded. Each import form offers a blank template.

| File | Columns |
|---|---|
| Register | `holder_id`, `units`, and optionally `holder_name`, `account`, `status` (`active` or `frozen`). Several holders may share one `account` (omnibus). |
| Journal | `ref`, `date`, `type` (`issue`, `transfer`, `redeem`, `clawback`), `units`, and optionally `from_account`, `to_account`, `tx_hash` |
| Instructions | `ref`, `type` (`authorize`, `freeze`, `unfreeze`, `clawback`), `account`, `issued_at`, and optionally `units` (required for a clawback), `approved_by`, `reason` |

## Deploying

The [`Dockerfile`](./Dockerfile) builds one image that serves the API and the dashboard. Give it
a volume at `/data`, put TLS in front, and set `CONCORD_PUBLIC_URL` to the https address people
open.

```sh
docker build -t concord .
docker run -p 4400:4400 -v concord-data:/data -e CONCORD_PUBLIC_URL=https://concord.example.com concord
```

Concord is a single process with a background indexer and SQLite files, so it needs one
always-on instance with a local disk. It does not fit serverless hosts.
[`render.yaml`](./render.yaml) deploys it to Render's **free** plan for a preview only: that plan
has no persistent disk, so every account, upload and sign-off is erased when the service restarts or
spins down after fifteen idle minutes (`CONCORD_EPHEMERAL=1` makes the dashboard say so). For
anything people should come back to, use an instance with a disk at `/data` and remove that variable;
the [paid Render disk and migration guide](./docs/deploy/render.md) covers that move.

TLS: [nginx and Certbot](./docs/deploy/nginx.md), [Caddy](./docs/deploy/caddy.md). Hosts:
[Docker Compose](./docs/deploy/docker-compose.md) (copy `.env.example` to `.env` at the repository
root, then `docker compose -f deploy/docker-compose.yml up -d --build`), [Fly.io](./docs/deploy/fly.md) (with the [single-machine template](./deploy/fly.toml)),
[systemd](./docs/deploy/systemd.md). Running it: [monitoring](./docs/monitoring.md),
[versioning](./docs/versioning.md), [upgrading and rolling back](./docs/upgrading.md).

## Layout and more documentation

Three packages: `packages/core` (the accounting, no I/O), `services/api` (RPC indexer, SQLite
stores, accounts and workspaces, HTTP API, CLI) and [`apps/web`](./apps/web/README.md) (the dashboard); see
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). Tables: [`docs/schema.md`](./docs/schema.md).
Stellar concepts for finance and compliance readers: [`docs/glossary-stellar.md`](./docs/glossary-stellar.md).
Architecture decisions: [`docs/adr/`](./docs/adr/README.md).

- [`docs/overview.md`](./docs/overview.md): what it does, what it flags, why now, who buys it.
- [`docs/limits.md`](./docs/limits.md): the deliberate limits; [`docs/ROADMAP.md`](./docs/ROADMAP.md)
  says which are next to fall.
- [`docs/prior-art.md`](./docs/prior-art.md): the prior-art check against the brief's first kill
  criterion (someone already ships this for Stellar): dated sources, kill criteria, re-check schedule.
- [`docs/demo-testnet.md`](./docs/demo-testnet.md): `pnpm demo:testnet` issues a practice asset on
  testnet and writes invented books for development, which disagree with the chain in known ways.

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, the rules
that matter and the full list of contributor guides, and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for how the code fits together. Report security
problems privately, as described in [`SECURITY.md`](./SECURITY.md). Everyone taking part is expected
to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE). User-visible and schema changes are listed in [`CHANGELOG.md`](./CHANGELOG.md).
