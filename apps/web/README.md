# Dashboard package (`apps/web`)

This is Concord's React/Vite dashboard. The API owns authentication, persistence, and production HTTP serving; this package renders the UI and calls the same-origin `/api` endpoints.

## Start from a fresh checkout

Requirements: Node.js **24 or newer** and pnpm **10.22 or newer** (see the root `package.json`).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @concord/core build
pnpm dev
```

Open **http://127.0.0.1:4401**. The root `pnpm dev` runs both the API and Vite; using only `pnpm --filter @concord/web dev` requires the API to be running separately. The API is on port **4400** by default. The React app requests relative `/api/*` paths; `apps/web/vite.config.ts` proxies them to `http://127.0.0.1:${CONCORD_PORT ?? PORT ?? 4400}`. Set `CONCORD_PORT` (or `PORT`) for a different API port before starting Vite. See `.env.example`.

The `packages/core` workspace contains accounting logic used by the API. Build it before working on the complete workspace, especially after a fresh install or a change to its TypeScript output.

## Commands

Run these from the repository root:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run API and dashboard together with reload |
| `pnpm --filter @concord/web dev` | Run Vite dashboard only (API must already be running) |
| `pnpm --filter @concord/web typecheck` | Check dashboard TypeScript without emitting |
| `pnpm --filter @concord/web build` | Typecheck via `tsc -p tsconfig.json --noEmit`, then build with Vite |
| `pnpm --filter @concord/web test` | Run Vitest component/unit tests |
| `pnpm --filter @concord/web e2e` | Run Playwright smoke checks (requires its browser/dependencies) |
| `pnpm --filter @concord/web test:a11y` | Run Playwright accessibility checks |

Scripts are defined in `apps/web/package.json`; the test environment and `src/test/setup.ts` are configured in `apps/web/vite.config.ts`.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/main.tsx` | Browser entry point |
| `src/App.tsx` | App routing and top-level dashboard composition |
| `src/Auth.tsx` | Sign-in, sign-up, and credential screens |
| `src/Overview.tsx` | Asset list and watch flow |
| `src/Settings.tsx` | Workspace/asset settings |
| `src/tabs/` | Holdings, reconciliation, corporate actions, controls and export tabs |
| `src/api.ts` | Same-origin API client, session-error event, downloads and API types |
| `src/session.tsx` | Session and current workspace context |
| `src/ui.tsx`, `src/index.css` | Shared components and design tokens |
| `src/breaks.tsx` | Break/reconciliation presentation helpers |
| `src/test/`, `src/**/*.test.{ts,tsx}` | Test setup and unit/component tests |
| `e2e/` | Playwright browser tests |

## Production and troubleshooting

`pnpm --filter @concord/web build` produces static dashboard assets. Production runs through the **API service** (see root `pnpm start`, `services/api`, and the `Dockerfile`), not through a public Vite development server. The API serves the built dashboard and handles `/api` on the same origin, so normal requests and cookies do not require a separate cross-origin configuration.

If the dashboard loads but API requests fail, check that the API is running and that `CONCORD_PORT` / `PORT` agrees with the Vite proxy. If imports from `@concord/core` fail, build that workspace and retry. A new instance has no holder data; see the [local testnet walkthrough](../../docs/contributing/web-dev.md) for creating a workspace and loading demo data.

Do not commit personal account information, register exports or live holder data in tests or screenshots.
