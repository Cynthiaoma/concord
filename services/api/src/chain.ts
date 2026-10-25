import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { readFileSync } from "node:fs";
import { Address, Asset, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";
import { isEventKind, parseUnits, type AssetEvent, type Opening } from "@concord/core";
import type { Endpoint, NetworkConfig } from "./config.js";

// Node gives each address family 250ms to connect before trying the next, which fails outright
// on a slow link.
setDefaultAutoSelectFamilyAttemptTimeout(5000);
const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const USER_AGENT = `concord/${PACKAGE_VERSION} (+https://github.com/useconcord/concord)`;

export interface EventPage {
  events: AssetEvent[];
  cursor?: string;
  latestLedger: number;
  /** ISO-8601 close time of latestLedger, when the RPC reports it. */
  latestLedgerClosedAt?: string;
  /** Events the RPC returned that could not be read (malformed XDR or fields); not counted: events of kinds Concord ignores. */
  skipped?: number;
}

export interface Baseline {
  ledger: number;
  openings: Map<string, Opening>;
}

export interface ChainHead {
  latest: number;
  /** The earliest ledger the RPC still holds events for. */
  oldest: number;
  oldestClosedAt?: string;
}

/** What the ledger itself says about an asset. */
export interface AssetDescription {
  /** Present when a contract id turns out to be the contract of a classic asset. */
  code?: string;
  issuer?: string;
  decimals?: number;
  name?: string;
}

/** A classic asset found by code. */
export interface AssetCandidate {
  /** CODE:ISSUER, ready to watch. */
  asset: string;
  code: string;
  issuer: string;
  contractId: string;
  trustlines: number;
  authorizedUnits: string;
  authRequired: boolean;
  authRevocable: boolean;
  clawbackEnabled: boolean;
}

/** What the indexer needs from a ledger data source. Tests supply an in-memory one. */
export interface ChainSource {
  latestLedger(): Promise<ChainHead>;
  /** Either startLedger or cursor. */
  getEvents(contractId: string, from: { startLedger: number } | { cursor: string }, limit: number): Promise<EventPage>;
  baseline(code: string, issuer: string, decimals: number): Promise<Baseline>;
  /** Undefined when the network has no such asset. A source without this cannot check. */
  describe?(asset: ResolvedAsset): Promise<AssetDescription | undefined>;
  search?(code: string): Promise<AssetCandidate[]>;
}

/** A failure of the ledger data source, worded for the person looking at the dashboard. */
export class ChainError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "rate_limited" | "rejected",
  ) {
    super(message);
  }
}

export interface ResolvedAsset {
  id: string;
  code: string;
  issuer?: string;
}

/** Accepts CODE:ISSUER for a classic asset or a C... contract id for a SEP-41 token. */
export function resolveAsset(spec: string, passphrase: string): ResolvedAsset {
  const s = spec.trim();
  if (/^(native|xlm)$/i.test(s)) {
    return { id: Asset.native().contractId(passphrase), code: "XLM" };
  }
  // Stellar strkeys use uppercase base32. Normalize pasted lowercase contract ids,
  // but leave classic asset codes and issuer validation unchanged.
  const contract = s.toUpperCase();
  if (StrKey.isValidContract(contract)) {
    return { id: contract, code: `${contract.slice(0, 4)}…${contract.slice(-4)}` };
  }
  const [code, issuer, ...rest] = s.split(":");
  if (!code || !issuer || rest.length || !StrKey.isValidEd25519PublicKey(issuer)) {
    throw new Error(`asset must be CODE:ISSUER or a contract id, got "${spec}"`);
  }
  return { id: new Asset(code, issuer).contractId(passphrase), code, issuer };
}

export interface RawEvent {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  txHash: string;
  topic: string[];
  value: string;
}

/** Account, contract, muxed account, liquidity pool or claimable balance. */
const ADDRESS = /^[GCMLB][A-Z2-7]{55,}$/;

/** Event ids already reported as unreadable, so a page that is fetched twice logs once. */
const loggedMalformed = new Set<string>();

function native(b64: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(b64, "base64"));
}

/** What became of one raw event. `malformed` separates "unreadable" from "not one we track". */
export interface Decoded {
  event?: AssetEvent;
  malformed: boolean;
}

const IGNORED: Decoded = { malformed: false };
const MALFORMED: Decoded = { malformed: true };

/**
 * Decode one event, never throwing. An event of a kind Concord does not track is ignored; one that
 * is a tracked kind but cannot be read (bad XDR, missing address, wrong value type) is malformed.
 * CAP-67 topics are [name, ...addresses, sep11 asset]; releases before Protocol 23 put the admin
 * first on mint, clawback and set_authorized, so the subject is always the last address.
 */
export function decodeEventDetailed(raw: RawEvent): Decoded {
  try {
    const topics = raw.topic.map(native);
    const kind = topics[0];
    if (typeof kind !== "string" || !isEventKind(kind)) return IGNORED;
    const addresses = topics.slice(1).filter((t): t is string => typeof t === "string" && ADDRESS.test(t));
    const last = addresses.at(-1);
    if (!last) return MALFORMED;
    const time = Date.parse(raw.ledgerClosedAt);
    if (Number.isNaN(time)) return MALFORMED;
    const event: AssetEvent = {
      id: raw.id,
      assetId: raw.contractId,
      kind,
      ledger: raw.ledger,
      closedAt: new Date(time).toISOString(),
      txHash: raw.txHash,
      amount: 0n,
    };
    const value = native(raw.value);
    if (kind === "set_authorized") {
      if (typeof value !== "boolean") return MALFORMED;
      event.from = last;
      event.authorized = value;
      return { event, malformed: false };
    }
    // A muxed destination turns the value into a map carrying the amount.
    const amount = typeof value === "object" && value !== null ? (value as { amount?: unknown }).amount : value;
    if (typeof amount !== "bigint" || amount < 0n) return MALFORMED;
    event.amount = amount;
    if (kind === "transfer") {
      if (addresses.length < 2) return MALFORMED;
      event.from = addresses[0]!;
      event.to = addresses[1]!;
    } else if (kind === "mint") {
      event.to = last;
    } else {
      event.from = last;
    }
    return { event, malformed: false };
  } catch {
    // invalid base64, truncated XDR, or a raw event of the wrong shape
    return MALFORMED;
  }
}

/** Decode one event, or undefined when it is ignored or unreadable. Never throws. */
export function decodeEvent(raw: RawEvent): AssetEvent | undefined {
  return decodeEventDetailed(raw).event;
}

/** This endpoint failed in a way another one, or a later attempt, might not. */
class EndpointFailure extends Error {
  constructor(
    message: string,
    readonly options: { limited?: boolean; restMs?: number; retrySame?: boolean } = {},
  ) {
    super(message);
  }
}

export interface ChainDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const realDeps: ChainDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

/** Enough for a small answer. A full page of events or accounts gets PAGE_TIMEOUT_MS. */
const ATTEMPT_TIMEOUT_MS = 20_000;
/** A page can run to megabytes, and a slow link needs time to read it. */
const PAGE_TIMEOUT_MS = 60_000;
const ATTEMPTS_PER_ENDPOINT = 2;
/** Tries at one page of a long read before the whole read is given up. */
const PAGE_ATTEMPTS = 3;
const REST_MS = 30_000;
/** Respect provider rate-limit backoffs, up to fifteen minutes per endpoint. */
const MAX_REST_MS = 15 * 60_000;
/** A request is abandoned after this long, however many endpoints remain. */
const BUDGET_MS = 90_000;

// Provider keys often sit in the URL path, so only the host is ever shown.
const hostOf = (url: string) => new URL(url).host;

/** Encode all Horizon query values, including asset codes and issuer identifiers. */
const horizonPath = (path: string, params: Record<string, string>): string =>
  `${path}?${new URLSearchParams(params).toString()}`;

function retryAfterMs(res: Response, now: number): number {
  const header = res.headers.get("retry-after");
  if (!header) return REST_MS;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 1000), MAX_REST_MS) : REST_MS;
}

/** Endpoints for one service, used in order, with failing ones rested. */
class EndpointPool {
  private readonly restUntil = new Map<string, number>();

  constructor(
    private readonly label: string,
    private readonly endpoints: Endpoint[],
    private readonly deps: ChainDeps,
  ) {}

  async run<T>(call: (endpoint: Endpoint) => Promise<T>): Promise<T> {
    const started = this.deps.now();
    const awake = this.endpoints.filter((e) => (this.restUntil.get(e.url) ?? 0) <= started);
    if (awake.length === 0) {
      const wait = Math.min(...this.endpoints.map((e) => this.restUntil.get(e.url) ?? 0)) - started;
      throw new ChainError(
        `${this.label} is not answering; trying again in ${Math.max(1, Math.ceil(wait / 1000))}s`,
        "unavailable",
      );
    }
    const failures: string[] = [];
    let limited = 0;
    for (const endpoint of awake) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await call(endpoint);
        } catch (err) {
          if (!(err instanceof EndpointFailure)) throw err;
          const outOfTime = this.deps.now() - started >= BUDGET_MS;
          if (err.options.retrySame && attempt < ATTEMPTS_PER_ENDPOINT && !outOfTime) {
            await this.deps.sleep(250 * 2 ** (attempt - 1) + Math.random() * 250);
            continue;
          }
          if (err.options.limited) limited++;
          this.restUntil.set(endpoint.url, this.deps.now() + (err.options.restMs ?? REST_MS));
          failures.push(`${hostOf(endpoint.url)}: ${err.message}`);
          break;
        }
      }
      if (this.deps.now() - started >= BUDGET_MS) break;
    }
    throw new ChainError(
      `${this.label} is unavailable (${failures.join("; ")})`,
      limited > 0 && limited === failures.length ? "rate_limited" : "unavailable",
    );
  }
}

interface HorizonAsset {
  asset_code: string;
  asset_issuer: string;
  contract_id?: string;
  accounts: { authorized: number; authorized_to_maintain_liabilities: number; unauthorized: number };
  balances: { authorized: string };
  flags: { auth_required: boolean; auth_revocable: boolean; auth_clawback_enabled: boolean };
}

interface AccountsPage {
  _links: { next?: { href: string } };
  _embedded: {
    records: Array<{
      account_id: string;
      balances: Array<{ asset_code?: string; asset_issuer?: string; balance: string; is_authorized?: boolean }>;
    }>;
  };
}

export class StellarSource implements ChainSource {
  private readonly rpcPool: EndpointPool;
  private readonly horizonPool: EndpointPool;
  private readonly deps: ChainDeps;
  private headCache?: { head: ChainHead; expiresAt: number };
  private headInFlight?: Promise<ChainHead>;

  constructor(
    private readonly network: NetworkConfig,
    deps: Partial<ChainDeps> = {},
  ) {
    this.deps = { ...realDeps, ...deps };
    this.rpcPool = new EndpointPool(`Stellar RPC (${network.name})`, network.rpc, this.deps);
    this.horizonPool = new EndpointPool(`Horizon (${network.name})`, network.horizon, this.deps);
  }

  /** One HTTP exchange. Anything worth trying elsewhere surfaces as an EndpointFailure. */
  private async send(endpoint: Endpoint, url: string, init: RequestInit = {}, timeoutMs = ATTEMPT_TIMEOUT_MS): Promise<Response> {
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        ...init,
        headers: {
          "user-agent": this.network.userAgentSuffix ? `${USER_AGENT} ${this.network.userAgentSuffix}` : USER_AGENT,
          ...(init.headers as Record<string, string> | undefined),
          ...endpoint.headers,
        },
        // Covers reading the body too, not just the wait for headers.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = (err as Error).name === "TimeoutError";
      throw new EndpointFailure(timedOut ? "timed out" : "unreachable", { retrySame: true });
    }
    if (res.status === 401 || res.status === 403) {
      throw new EndpointFailure("bad API key");
    }
    if (res.status === 429) {
      throw new EndpointFailure("rate limited", { limited: true, restMs: retryAfterMs(res, this.deps.now()) });
    }
    if (res.status === 400 || res.status === 404 || res.status === 422) {
      throw new ChainError(`HTTP ${res.status}`, "rejected");
    }
    if (res.status >= 500) throw new EndpointFailure(`HTTP ${res.status}`, { retrySame: true });
    if (!res.ok) throw new EndpointFailure(`HTTP ${res.status}`);
    return res;
  }

  private async json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new EndpointFailure("unreadable response", { retrySame: true });
    }
  }

  private rpc<T>(method: string, params?: unknown, timeoutMs = ATTEMPT_TIMEOUT_MS): Promise<T> {
    return this.rpcPool.run(async (endpoint) => {
      const res = await this.send(
        endpoint,
        endpoint.url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        },
        timeoutMs,
      );
      const body = await this.json<{ result?: T; error?: { code?: number; message: string; data?: unknown } }>(res);
      if (body.error) {
        const { code, message } = body.error;
        const msg = (message || "").toLowerCase();

        const isRateLimit =
          code === 429 ||
          code === -32005 || // standard JSON-RPC Rate limit exceeded
          msg.includes("rate limit") ||
          msg.includes("too many requests");

        if (isRateLimit) {
          throw new EndpointFailure(message || "rate limit exceeded", { limited: true, restMs: REST_MS });
        }

        const isTransientProviderError =
          code === -32603 || // Internal error
          code === 500 ||
          code === 502 ||
          code === 503 ||
          code === 504 ||
          msg.includes("behind") ||
          msg.includes("internal error") ||
          msg.includes("service unavailable");

        if (isTransientProviderError) {
          throw new EndpointFailure(message || `RPC error ${code ?? ""}`.trim());
        }

        // Standard request errors (e.g. -32600, -32602, bad params, ledger range, invalid request)
        // stay terminal ChainError and do not retry or fail over.
        throw new ChainError(`Stellar RPC ${method}: ${message}`, "rejected");
      }
      if (body.result === undefined || body.result === null) {
        throw new ChainError(`Stellar RPC ${method} returned no result`, "rejected");
      }
      return body.result as T;
    });
  }

  private horizon<T>(pathAndQuery: string, validate?: (body: unknown) => T): Promise<T> {
    return this.horizonPool.run(async (endpoint) => {
      const body = await this.json<unknown>(await this.send(endpoint, `${endpoint.url}${pathAndQuery}`));
      return validate ? validate(body) : (body as T);
    });
  }

  /** Reuse the same short-lived chain head across workspaces during a sync pass. */
  async latestLedger(): Promise<ChainHead> {
    const cached = this.headCache;
    if (cached && this.deps.now() < cached.expiresAt) return cached.head;
    if (this.headInFlight) return this.headInFlight;
    const pending = this.fetchLatestLedger().then((head) => {
      this.headCache = { head, expiresAt: this.deps.now() + 2_000 };
      return head;
    });
    this.headInFlight = pending;
    try {
      return await pending;
    } finally {
      if (this.headInFlight === pending) this.headInFlight = undefined;
    }
  }

  private async fetchLatestLedger(): Promise<ChainHead> {
    const h = await this.rpc<{ latestLedger: number; oldestLedger: number; oldestLedgerCloseTime?: string }>("getHealth");
    if (!Number.isInteger(h?.latestLedger) || !Number.isInteger(h?.oldestLedger)) {
      throw new ChainError("Stellar RPC getHealth did not report its ledger range", "rejected");
    }
    const head: ChainHead = { latest: h.latestLedger, oldest: h.oldestLedger };
    const closed = Number(h.oldestLedgerCloseTime);
    if (closed > 0) head.oldestClosedAt = new Date(closed * 1000).toISOString();
    return head;
  }

  async getEvents(
    contractId: string,
    from: { startLedger: number } | { cursor: string },
    limit: number,
  ): Promise<EventPage> {
    const pagination = "cursor" in from ? { cursor: from.cursor, limit } : { limit };
    const params = {
      ...("startLedger" in from ? { startLedger: from.startLedger } : {}),
      filters: [{ type: "contract", contractIds: [contractId] }],
      pagination,
    };
    const res = await this.rpc<{
      events: RawEvent[];
      cursor?: string;
      latestLedger: number;
      latestLedgerCloseTime?: string;
    }>("getEvents", params, PAGE_TIMEOUT_MS);
    const events: AssetEvent[] = [];
    let skipped = 0;
    for (const raw of res.events ?? []) {
      const { event, malformed } = decodeEventDetailed(raw);
      if (event) {
        events.push(event);
      } else if (malformed) {
        skipped++;
        // Once per event id: the same page is fetched again until the cursor moves past it.
        if (!loggedMalformed.has(String(raw?.id))) {
          if (loggedMalformed.size >= 1000) loggedMalformed.clear();
          loggedMalformed.add(String(raw?.id));
          console.warn(`skipping unreadable event ${String(raw?.id)}`);
        }
      }
    }
    const page: EventPage = { events, latestLedger: res.latestLedger, skipped };
    const closed = Number(res.latestLedgerCloseTime);
    if (closed > 0) page.latestLedgerClosedAt = new Date(closed * 1000).toISOString();
    if (res.cursor) page.cursor = res.cursor;
    return page;
  }

  /**
   * Trustline balances from Horizon. Each page reports the ledger it reflects, and that becomes
   * the holder's cut-off. Pools, claimable balances and contracts are not listed by Horizon, so
   * a baseline understates supply by whatever they hold.
   */
  baseline(code: string, issuer: string, decimals: number): Promise<Baseline> {
    // One endpoint serves every page: a second, lagging one could hand back an older ledger and
    // put a holder's cut-off before events already counted.
    return this.horizonPool.run(async (endpoint) => {
      const openings = new Map<string, Opening>();
      let ledger: number | undefined;
      let path: string | undefined = horizonPath("/accounts", {
        asset: `${code}:${issuer}`,
        limit: "200",
        order: "asc",
      });
      while (path) {
        const { body, pageLedger } = await this.accountsPage(endpoint, path);
        if (ledger !== undefined && pageLedger < ledger) throw new EndpointFailure("went back in time mid-read");
        ledger ??= pageLedger;
        const records = body._embedded.records;
        for (const record of records) {
          const line = record.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer);
          if (!line) continue;
          const opening: Opening = { amount: parseUnits(line.balance, decimals), asOfLedger: pageLedger };
          if (line.is_authorized !== undefined) opening.authorized = line.is_authorized;
          openings.set(record.account_id, opening);
        }
        const next = records.length === 200 ? body._links.next?.href : undefined;
        // Horizon links are absolute; keep the path so the request stays on this endpoint.
        path = next ? `${new URL(next).pathname}${new URL(next).search}` : undefined;
      }
      if (ledger === undefined) throw new EndpointFailure("returned no pages");
      return { ledger, openings };
    });
  }

  /**
   * One page of trustlines. A long read is a dozen of these; a page that fails is asked for
   * again rather than starting the whole read over.
   */
  private async accountsPage(endpoint: Endpoint, path: string): Promise<{ body: AccountsPage; pageLedger: number }> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.send(endpoint, `${endpoint.url}${path}`, {}, PAGE_TIMEOUT_MS);
        const pageLedger = Number(res.headers.get("latest-ledger"));
        if (!pageLedger) throw new EndpointFailure("no Latest-Ledger header");
        const body = await this.json<AccountsPage>(res);
        if (!body?._embedded || !Array.isArray(body._embedded.records)) {
          throw new EndpointFailure("unexpected response");
        }
        return { body, pageLedger };
      } catch (err) {
        if (!(err instanceof EndpointFailure) || !err.options.retrySame || attempt >= PAGE_ATTEMPTS) throw err;
        await this.deps.sleep(500 * 2 ** (attempt - 1) + Math.random() * 250);
      }
    }
  }

  private async horizonAssets(code: string, issuer?: string): Promise<HorizonAsset[]> {
    const params = { asset_code: code, ...(issuer ? { asset_issuer: issuer } : {}), limit: "200" };
    return this.horizon(horizonPath("/assets", params), (body) => {
      const records = (body as { _embedded?: { records?: HorizonAsset[] } })?._embedded?.records;
      if (!Array.isArray(records)) throw new EndpointFailure("unexpected response");
      return records;
    });
  }

  async search(code: string): Promise<AssetCandidate[]> {
    const records = await this.horizonAssets(code);
    return records
      .map((r) => ({
        asset: `${r.asset_code}:${r.asset_issuer}`,
        code: r.asset_code,
        issuer: r.asset_issuer,
        contractId: r.contract_id ?? new Asset(r.asset_code, r.asset_issuer).contractId(this.network.passphrase),
        trustlines: r.accounts.authorized + r.accounts.authorized_to_maintain_liabilities + r.accounts.unauthorized,
        authorizedUnits: r.balances.authorized,
        authRequired: r.flags.auth_required,
        authRevocable: r.flags.auth_revocable,
        clawbackEnabled: r.flags.auth_clawback_enabled,
      }))
      .sort((a, b) => b.trustlines - a.trustlines);
  }

  async describe(asset: ResolvedAsset): Promise<AssetDescription | undefined> {
    if (asset.issuer) {
      const records = await this.horizonAssets(asset.code, asset.issuer);
      return records.length > 0 ? { decimals: 7 } : undefined;
    }
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(asset.id).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent,
      }),
    ).toXDR("base64");
    const res = await this.rpc<{ entries?: Array<{ xdr: string }> }>("getLedgerEntries", { keys: [key] });
    const entry = res.entries?.[0];
    if (!entry) return undefined;
    return describeInstance(entry.xdr, this.network.passphrase, asset.id);
  }
}

/** Read a token's own metadata out of its contract instance entry. */
export function describeInstance(entryXdr: string, passphrase: string, contractId: string): AssetDescription {
  const out: AssetDescription = {};
  let storage: Array<{ key: xdr.ScVal; val: xdr.ScVal }> = [];
  try {
    const data = xdr.LedgerEntryData.fromXDR(entryXdr, "base64") as unknown as {
      contractData: { val: { instance?: { storage?: Array<{ key: xdr.ScVal; val: xdr.ScVal }> | null } } };
    };
    storage = data.contractData.val.instance?.storage ?? [];
  } catch {
    return out;
  }
  for (const item of storage) {
    let key: unknown;
    let value: unknown;
    try {
      key = scValToNative(item.key);
      value = scValToNative(item.val);
    } catch {
      continue;
    }
    // The token SDK and the built-in asset contract both keep {decimal, name, symbol} here.
    if (key === "METADATA" && typeof value === "object" && value !== null) {
      const meta = value as { decimal?: unknown; name?: unknown; symbol?: unknown };
      const decimal = Number(meta.decimal);
      if (Number.isInteger(decimal) && decimal >= 0 && decimal <= 38) out.decimals = decimal;
      if (typeof meta.symbol === "string" && meta.symbol) out.code = meta.symbol;
      if (typeof meta.name === "string" && meta.name) out.name = meta.name;
    }
    // Only the contract of a classic asset carries this; it names the asset it wraps.
    if (Array.isArray(key) && key[0] === "AssetInfo" && Array.isArray(value) && typeof value[1] === "object") {
      const info = value[1] as { asset_code?: unknown; issuer?: unknown };
      const code = typeof info.asset_code === "string" ? info.asset_code.replace(/\0+$/, "") : "";
      try {
        const issuer = StrKey.encodeEd25519PublicKey(Buffer.from(info.issuer as Uint8Array));
        if (code && new Asset(code, issuer).contractId(passphrase) === contractId) {
          out.code = code;
          out.issuer = issuer;
          out.decimals = 7;
        }
      } catch {
        // Not a classic asset after all.
      }
    }
  }
  // A classic asset's contract reports its name as CODE:ISSUER, which is no name at all.
  if (out.issuer) delete out.name;
  return out;
}

/** Ledger sequence encoded in an RPC event id or cursor (a TOID followed by an optional index). */
export function cursorLedger(cursor: string): number {
  if (!/^\d+(-\d+)?$/.test(cursor)) {
    throw new ChainError(`invalid cursor: ${cursor}`, "rejected");
  }
  return Number(BigInt(cursor.split("-")[0]!) >> 32n);
}
