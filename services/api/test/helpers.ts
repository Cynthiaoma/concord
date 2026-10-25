import { Keypair } from "@stellar/stellar-sdk";
import type { Hono } from "hono";
import type { AssetEvent, EventKind } from "@concord/core";
import { createApi, type ApiOptions } from "../src/api.js";
import { Auth } from "../src/auth.js";
import type { Baseline, ChainSource, EventPage } from "../src/chain.js";
import type { Networks } from "../src/concord.js";
import { Db } from "../src/db.js";
import { CONTROL_MIGRATIONS } from "../src/schema.js";
import { Tenants, memoryStore, type OrgStore } from "../src/tenants.js";

export const PASSPHRASE = "Test SDF Network ; September 2015";
export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
export const T0 = Date.parse("2026-10-01T00:00:00Z");
export const at = (ledger: number) => new Date(T0 + ledger * 60_000).toISOString();
export const u = (n: number) => BigInt(n) * 10_000_000n;
export const key = () => Keypair.random().publicKey();
export const ORIGIN = "http://concord.test";
/** Real scrypt, at a cost that keeps the suite quick. */
export const FAST = { N: 1024, r: 8, p: 1 };

/** Ledger n closes n minutes after T0. Event ids follow the RPC's TOID-index layout. */
export class FakeChain implements ChainSource {
  latest = 100;
  oldest = 1;
  events: AssetEvent[] = [];
  baselineResult: Baseline | undefined;
  calls = 0;
  /** Throw on this getEvents call (1-based), once. */
  failOnCall: number | undefined;

  push(assetId: string, kind: EventKind, ledger: number, f: Partial<AssetEvent> = {}): AssetEvent {
    const toid = (BigInt(ledger) << 32n).toString().padStart(19, "0");
    const ev: AssetEvent = {
      id: `${toid}-${String(this.events.length).padStart(10, "0")}`,
      assetId,
      kind,
      ledger,
      closedAt: at(ledger),
      txHash: `tx${this.events.length}`,
      amount: 0n,
      ...f,
    };
    this.events.push(ev);
    return ev;
  }

  async latestLedger() {
    return { latest: this.latest, oldest: this.oldest };
  }

  async getEvents(contractId: string, from: { startLedger: number } | { cursor: string }, limit: number): Promise<EventPage> {
    this.calls++;
    if (this.failOnCall === this.calls) {
      this.failOnCall = undefined;
      throw new Error("connection reset");
    }
    const pending = this.events
      .filter((e) => e.assetId === contractId && e.ledger <= this.latest)
      .filter((e) => ("cursor" in from ? e.id > from.cursor : e.ledger >= from.startLedger))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const events = pending.slice(0, limit);
    const end = `${(BigInt(this.latest) << 32n).toString().padStart(19, "0")}-9999999999`;
    return {
      events,
      cursor: events.length === limit ? events.at(-1)!.id : end,
      latestLedger: this.latest,
      latestLedgerClosedAt: at(this.latest),
    };
  }

  async baseline(): Promise<Baseline> {
    if (!this.baselineResult) throw new Error("no baseline");
    return this.baselineResult;
  }
}

export interface Harness {
  app: Hono;
  auth: Auth;
  tenants: Tenants;
  chain: FakeChain;
  control: Db;
  removed: string[];
  now: { value: number };
}

/** The whole service over in-memory databases and a fake chain. */
export function harness(
  options: Partial<ApiOptions> = {},
  networks?: Networks,
  authOptions: { maxInvites?: number } = {},
): Harness {
  const now = { value: Date.now() };
  const control = new Db(":memory:", CONTROL_MIGRATIONS);
  const auth = new Auth(control, { signup: options.signup ?? "open", cost: FAST, now: () => now.value, ...authOptions });
  const chain = new FakeChain();
  const removed: string[] = [];
  const inner = memoryStore();
  const store: OrgStore = { open: inner.open, remove: (id) => void removed.push(id) };
  const tenants = new Tenants(
    store,
    networks ?? { testnet: { passphrase: PASSPHRASE, chain } },
    (id) => auth.orgExists(id),
    () => auth.orgIds(),
  );
  const app = createApi(tenants, auth, {
    publicUrl: ORIGIN,
    signup: "open",
    ephemeral: false,
    networks: ["testnet"],
    defaultNetwork: "testnet",
    maxAssetsPerOrg: 10,
    trustProxyHops: 0,
    ...options,
  });
  return { app, auth, tenants, chain, control, removed, now };
}

/** A browser, more or less: keeps cookies and says where it is calling from. */
export class Client {
  cookies = new Map<string, string>();
  orgId = "";
  userId = "";

  constructor(
    private readonly app: Hono,
    private readonly origin: string | null = ORIGIN,
  ) {}

  async call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...init.headers };
    if (this.origin) headers.origin = this.origin;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await this.app.request(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [name, ...value] = pair!.split("=");
      const gone = attrs.some((a) => /max-age=0/i.test(a)) || value.join("=") === "";
      if (gone) this.cookies.delete(name!);
      else this.cookies.set(name!, value.join("="));
    }
    return res;
  }

  async json<T = Record<string, unknown>>(path: string, init: Parameters<Client["call"]>[1] = {}): Promise<T> {
    const res = await this.call(path, init);
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text}`);
    return JSON.parse(text) as T;
  }

  async signUp(email: string, orgName: string, name = "Test User"): Promise<this> {
    const me = await this.json<{ user: { id: string }; org: { id: string } }>("/api/auth/signup", {
      body: { email, name, password: "correct horse battery", orgName },
    });
    this.orgId = me.org.id;
    this.userId = me.user.id;
    return this;
  }
}
