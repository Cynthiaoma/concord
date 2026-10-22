import { ArrowsClockwise, GearSix, SignOut } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api, type AssetSummary, type Network, type Overview as OverviewData } from "./api";
import { EphemeralNotice, Invite, Reset, SignIn, SignUp, googleError } from "./Auth";
import { Overview } from "./Overview";
import { Settings } from "./Settings";
import { SessionProvider, useMe, useSession } from "./session";
import { Actions } from "./tabs/Actions";
import { Controls } from "./tabs/Controls";
import { Events } from "./tabs/Events";
import { Export } from "./tabs/Export";
import { Holdings } from "./tabs/Holdings";
import { Reconciliation } from "./tabs/Reconciliation";
import {
  Addr,
  Badge,
  Button,
  ErrorBoundary,
  ErrorNote,
  Field,
  NetworkContext,
  Notice,
  Segmented,
  Skeleton,
  Units,
  inputClass,
  useAction,
  when,
} from "./ui";

const TABS = [
  ["reconciliation", "Reconciliation"],
  ["holdings", "Holdings"],
  ["actions", "Corporate actions"],
  ["controls", "Controls"],
  ["events", "Events"],
  ["export", "Audit export"],
] as const;
type TabKey = (typeof TABS)[number][0];

interface Route {
  page: "home" | "asset" | "settings" | "signin" | "signup" | "invite" | "reset";
  assetId?: string;
  tab: TabKey;
  token?: string;
  query: URLSearchParams;
}

function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const [path = "", search = ""] = hash.replace(/^#/, "").split("?");
  const [, scope, first, second] = path.split("/");
  const base = { tab: "reconciliation" as TabKey, query: new URLSearchParams(search) };
  if (scope === "a" && first) {
    const known = TABS.some(([key]) => key === second);
    return { ...base, page: "asset", assetId: first, tab: known ? (second as TabKey) : "reconciliation" };
  }
  if ((scope === "invite" || scope === "reset") && first) return { ...base, page: scope, token: first };
  if (scope === "settings" || scope === "signin" || scope === "signup") return { ...base, page: scope };
  return { ...base, page: "home" };
}

const NETWORK_LABEL: Record<Network, string> = { mainnet: "Mainnet", testnet: "Testnet" };

function AssetSettings({ asset, onChange, onClose }: { asset: AssetSummary; onChange: () => void; onClose: () => void }) {
  const me = useMe();
  const [name, setName] = useState(asset.name);
  const [ignore, setIgnore] = useState(asset.ignore.join("\n"));
  const [confirming, setConfirming] = useState(false);
  const save = useAction();
  const rebuild = useAction();
  const remove = useAction();
  const history =
    asset.startMode === "baseline"
      ? `Opening balances from Horizon at ledger ${asset.baselineLedger ?? "…"}, events from ${asset.startLedger ?? "…"}`
      : asset.startMode === "window"
        ? `No opening balances; events from ledger ${asset.startLedger ?? "…"}`
        : `Replayed from ledger ${asset.startLedger ?? "…"}`;
  return (
    <section aria-label="Asset settings" className="flex flex-col gap-6 rounded border border-line bg-surface p-4">
      <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
        <dt className="text-muted">Contract</dt>
        <dd>
          <Addr value={asset.id} />
        </dd>
        <dt className="text-muted">Network</dt>
        <dd>{NETWORK_LABEL[asset.network]}</dd>
        <dt className="text-muted">Decimals</dt>
        <dd className="num">{asset.decimals}</dd>
        <dt className="text-muted">History</dt>
        <dd>{history}</dd>
      </dl>

      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(async () => {
            await api(`/assets/${asset.id}`, {
              method: "PATCH",
              body: { name: name.trim(), ignore: ignore.split(/[\s,]+/).filter(Boolean) },
            });
            onChange();
            onClose();
          });
        }}
      >
        <Field label="Display name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={120} required />
        </Field>
        <Field
          label="Addresses kept off the register"
          hint="Issuer treasury or distribution accounts, one per line. Their balances are not compared with the register."
        >
          <textarea value={ignore} onChange={(e) => setIgnore(e.target.value)} rows={3} spellCheck={false} className={`${inputClass} num h-auto py-1.5`} />
        </Field>
        {save.error && (
          <div className="md:col-span-2">
            <ErrorNote message={save.error} />
          </div>
        )}
        <div className="flex gap-2 md:col-span-2">
          <Button variant="primary" busy={save.busy} type="submit">
            Save
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </form>

      <div className="flex flex-col items-start gap-2 border-t border-line pt-4">
        <p className="max-w-[65ch] text-[13px] text-muted">
          Rebuilding discards the indexed events and reads the asset again
          {asset.issuer ? " from fresh opening balances" : " from the oldest ledger the network still keeps"}. Use it
          after a gap in indexing. Registers, journals, instructions, past reconciliations and sign-offs are kept.
        </p>
        {rebuild.error && <ErrorNote message={rebuild.error} />}
        <Button
          busy={rebuild.busy}
          onClick={() =>
            void rebuild.run(async () => {
              await api(`/assets/${asset.id}/rebuild`, { method: "POST" });
              onChange();
              onClose();
            })
          }
        >
          Rebuild history
        </Button>
      </div>

      <div className="flex flex-col items-start gap-2 border-t border-line pt-4">
        <p className="max-w-[65ch] text-[13px] text-muted">
          Stopping removes {asset.code} from this workspace together with every register, journal, instruction,
          reconciliation, corporate action and sign-off recorded against it. It cannot be undone.
        </p>
        {remove.error && <ErrorNote message={remove.error} />}
        {me.role !== "owner" ? (
          <p className="text-[13px]">Only a workspace owner can stop watching an asset.</p>
        ) : !confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Stop watching
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              busy={remove.busy}
              onClick={() =>
                void remove.run(async () => {
                  await api(`/assets/${asset.id}`, { method: "DELETE" });
                  location.hash = "#/";
                  onChange();
                })
              }
            >
              Delete {asset.code} and its books
            </Button>
            <Button onClick={() => setConfirming(false)}>Keep it</Button>
          </div>
        )}
      </div>
    </section>
  );
}

function AssetHeader({ asset, onChange }: { asset: AssetSummary; onChange: () => void }) {
  const { busy, error, run } = useAction();
  const [settings, setSettings] = useState(false);
  const rebuild = useAction();
  const indexing = asset.state === "indexing";
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {asset.name}
            {asset.network === "testnet" && <Badge tone="warn">Testnet</Badge>}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span className="num">{asset.code}</span>
            {asset.issuer && (
              <span className="flex items-center gap-1">
                Issuer <Addr value={asset.issuer} />
              </span>
            )}
            {!indexing && (
              <span>
                <Units value={asset.supply} /> units, {asset.holderCount.toLocaleString()} holders
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-right text-xs text-muted">
            {indexing ? (
              "Not indexed yet"
            ) : (
              <>
                Indexed to ledger <span className="num">{asset.syncedLedger ?? "none"}</span>
                <span className="block">{when(asset.syncedAt)}</span>
              </>
            )}
          </span>
          <Button
            busy={busy}
            onClick={() =>
              void run(async () => {
                await api(`/assets/${asset.id}/sync`, { method: "POST" });
                onChange();
              })
            }
          >
            <ArrowsClockwise size={16} />
            Sync
          </Button>
          <Button onClick={() => setSettings(!settings)} aria-expanded={settings}>
            <GearSix size={16} />
            Settings
          </Button>
        </div>
      </div>
      {error && <ErrorNote message={error} />}
      {settings && <AssetSettings asset={asset} onChange={onChange} onClose={() => setSettings(false)} />}

      {indexing && !asset.syncError && (
        <p role="status" className="rounded bg-sunken px-3 py-2 text-[13px]">
          {asset.startMode === "baseline"
            ? "Reading opening balances from Horizon, then recent events. A widely held asset takes a minute or two. Figures appear here when it is done."
            : "Finding where the indexed history starts. Figures appear here when it is done."}
        </p>
      )}
      {asset.syncError && (
        <div className="flex flex-col items-start gap-2">
          <ErrorNote
            message={
              indexing
                ? `Indexing has not started: ${asset.syncError} Concord keeps trying.`
                : `Indexing is failing, so the figures below stop at ${when(asset.syncedAt)}. ${asset.syncError}`
            }
          />
          {/rebuild/i.test(asset.syncError) && (
            <Button
              busy={rebuild.busy}
              onClick={() =>
                void rebuild.run(async () => {
                  await api(`/assets/${asset.id}/rebuild`, { method: "POST" });
                  onChange();
                })
              }
            >
              Rebuild history
            </Button>
          )}
          {rebuild.error && <ErrorNote message={rebuild.error} />}
        </div>
      )}
      {!indexing && asset.startMode === "window" && (
        <Notice>
          No opening balances are available for a contract token, so holdings here count only movements since{" "}
          {asset.historyFrom ? `about ${when(asset.historyFrom)}` : `ledger ${asset.startLedger}`}. Anything held before
          then is missing from every balance on these pages.
        </Notice>
      )}
      {!indexing && asset.incomplete && asset.startMode !== "window" && (
        <Notice>
          Some holders come out with a negative balance, which means this asset has history from before the indexed
          range. Open Settings and rebuild its history to take fresh opening balances.
        </Notice>
      )}
    </header>
  );
}

function Shell({ route }: { route: Route }) {
  const me = useMe();
  const { config, network, setNetwork, signOut } = useSession();
  const [data, setData] = useState<OverviewData>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    let live = true;
    api<OverviewData>("/overview")
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [tick]);

  // The server indexes in the background; keep the figures current without a manual refresh,
  // and look more often while an asset is still being read for the first time.
  const settling = data?.assets.some((a) => a.state === "indexing") ?? false;
  useEffect(() => {
    const id = setInterval(reload, settling ? 4_000 : 30_000);
    return () => clearInterval(id);
  }, [settling]);

  // After signing in, the address still names the sign-in page.
  useEffect(() => {
    if (route.page === "signin" || route.page === "signup" || route.page === "reset") location.hash = "#/";
  }, [route.page]);

  const asset = data?.assets.find((a) => a.id === route.assetId);
  // A link to an asset on the other network brings the switcher with it.
  useEffect(() => {
    if (asset && asset.network !== network) setNetwork(asset.network);
  }, [asset, network, setNetwork]);

  const shown = data?.assets.filter((a) => a.network === network) ?? [];
  const badge = (a: AssetSummary, key: TabKey) =>
    key === "reconciliation" ? a.openBreaks.reconciliation : key === "controls" ? a.openBreaks.controls : key === "actions" ? a.openBreaks.actions : 0;
  const link = (active: boolean) =>
    `whitespace-nowrap rounded px-2 py-1.5 text-[13px] transition-colors duration-150 ${active ? "bg-sunken font-medium" : "text-muted hover:bg-sunken hover:text-text"}`;

  return (
    <NetworkContext.Provider value={asset?.network ?? network}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="mx-auto grid min-h-[100dvh] max-w-[1400px] grid-cols-1 md:grid-cols-[232px_1fr]">
        <aside className="flex flex-col gap-4 border-b border-line px-4 py-4 md:border-b-0 md:border-r md:py-6">
          <div className="flex items-center justify-between gap-2">
            <a href="#/" className="text-base font-semibold tracking-tight">
              Concord
            </a>
            {config.networks.length > 1 && (
              <Segmented
                label="Network"
                value={network}
                options={config.networks.map((n) => ({ value: n, label: NETWORK_LABEL[n] }))}
                onChange={(next) => {
                  setNetwork(next);
                  if (route.page === "asset") location.hash = "#/";
                }}
              />
            )}
          </div>
          <nav aria-label="Assets" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            <a href="#/" aria-current={route.page === "home" ? "page" : undefined} className={link(route.page === "home")}>
              All assets
            </a>
            {shown.map((a) => {
              const open = a.openBreaks.reconciliation + a.openBreaks.controls + a.openBreaks.actions;
              const active = a.id === route.assetId;
              return (
                <a
                  key={a.id}
                  href={`#/a/${a.id}/${route.tab}`}
                  title={a.name}
                  aria-label={`${a.code}${a.syncError ? ", indexing is failing" : open > 0 ? `, ${open} open ${open === 1 ? "break" : "breaks"}` : ""}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 ${link(active)}`}
                >
                  <span className="num">{a.code}</span>
                  {a.syncError ? <Badge tone="warn">!</Badge> : open > 0 && <Badge tone="bad">{open}</Badge>}
                </a>
              );
            })}
          </nav>
          <div className="flex items-center justify-between gap-2 border-t border-line pt-3 md:mt-auto md:flex-col md:items-stretch md:gap-1">
            <div className="min-w-0 px-2 md:pb-1">
              <p className="truncate text-[13px] font-medium" title={me.org.name}>
                {me.org.name}
              </p>
              <p className="truncate text-xs text-muted" title={me.user.email}>
                {me.user.email}
              </p>
            </div>
            <div className="flex gap-1 md:flex-col">
              <a href="#/settings" aria-current={route.page === "settings" ? "page" : undefined} className={`flex items-center gap-2 ${link(route.page === "settings")}`}>
                <GearSix size={16} />
                Settings
              </a>
              <button type="button" onClick={() => void signOut()} className={`flex items-center gap-2 text-left ${link(false)}`}>
                <SignOut size={16} />
                Sign out
              </button>
            </div>
          </div>
        </aside>

        <main id="main" className="flex min-w-0 flex-col gap-6 px-4 py-6 md:px-8">
          <EphemeralNotice />
          {network === "testnet" && route.page !== "settings" && (
            <Notice>Testnet is a practice network. Nothing on these pages is a real security or a real holder.</Notice>
          )}
          <ErrorBoundary key={`${route.page}-${route.assetId ?? ""}-${route.tab}`}>
            {route.page === "settings" ? (
              <Settings query={route.query} />
            ) : (
              <>
                {error && <ErrorNote message={data ? `Figures may be out of date. ${error}` : error} />}
                {!data && !error && <Skeleton rows={8} />}
                {data && route.page !== "asset" && <Overview assets={shown} network={network} onChange={reload} />}
                {data && route.page === "asset" && !asset && (
                  <div className="flex flex-col items-start gap-3">
                    <ErrorNote message="This workspace is not watching that asset." />
                    <a href="#/" className="text-[13px] font-medium text-accent hover:underline">
                      All assets
                    </a>
                  </div>
                )}
                {asset && (
                  <>
                    <AssetHeader key={asset.id} asset={asset} onChange={reload} />
                    <nav aria-label="Sections" className="flex gap-5 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--line)]">
                      {TABS.map(([key, label]) => {
                        const n = badge(asset, key);
                        const active = key === route.tab;
                        return (
                          <a
                            key={key}
                            href={`#/a/${asset.id}/${key}`}
                            aria-label={n > 0 ? `${label}, ${n} open ${n === 1 ? "break" : "breaks"}` : undefined}
                            aria-current={active ? "page" : undefined}
                            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 text-[13px] transition-colors duration-150 ${active ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}
                          >
                            {label}
                            {n > 0 && <Badge tone="bad">{n}</Badge>}
                          </a>
                        );
                      })}
                    </nav>
                    {route.tab === "reconciliation" && <Reconciliation key={asset.id} asset={asset} onChange={reload} />}
                    {route.tab === "holdings" && <Holdings key={asset.id} asset={asset} />}
                    {route.tab === "actions" && <Actions key={asset.id} asset={asset} assets={shown} onChange={reload} />}
                    {route.tab === "controls" && <Controls key={asset.id} asset={asset} onChange={reload} />}
                    {route.tab === "events" && <Events key={asset.id} asset={asset} />}
                    {route.tab === "export" && <Export key={asset.id} asset={asset} />}
                  </>
                )}
              </>
            )}
          </ErrorBoundary>
        </main>
      </div>
    </NetworkContext.Provider>
  );
}

function Boot({ error }: { error?: string | undefined }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 px-4 pt-24">
      <p className="text-base font-semibold tracking-tight">Concord</p>
      {error ? (
        <>
          <ErrorNote message={error} />
          <div>
            <Button onClick={() => location.reload()}>Try again</Button>
          </div>
        </>
      ) : (
        <Skeleton rows={3} />
      )}
    </div>
  );
}

function Routes() {
  const route = useRoute();
  const { me } = useSession();
  const error = googleError(route.query.get("error") ?? undefined);
  if (route.page === "invite" && route.token) return <Invite key={route.token} token={route.token} />;
  if (!me) {
    if (route.page === "reset" && route.token) return <Reset token={route.token} />;
    return route.page === "signup" ? <SignUp error={error} /> : <SignIn error={error} />;
  }
  // Remounting on a workspace change drops everything loaded for the previous one.
  return <Shell key={me.org.id} route={route} />;
}

export function App() {
  return (
    <SessionProvider fallback={(error) => <Boot error={error} />}>
      <Routes />
    </SessionProvider>
  );
}
