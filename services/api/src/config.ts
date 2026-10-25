import { resolve } from "node:path";

export type NetworkName = "mainnet" | "testnet";
export const NETWORK_NAMES: readonly NetworkName[] = ["mainnet", "testnet"];

export function isNetworkName(value: unknown): value is NetworkName {
  return value === "mainnet" || value === "testnet";
}

export interface Endpoint {
  url: string;
  /** Sent with every request, e.g. a provider's API key header. */
  headers?: Record<string, string>;
}

export interface NetworkConfig {
  name: NetworkName;
  passphrase: string;
  /** Tried in order; a failing or rate-limited endpoint is rested and the next one used. */
  rpc: Endpoint[];
  horizon: Endpoint[];
  /** Optional provider contact details appended to outbound User-Agent. */
  userAgentSuffix?: string;
}

const DEFAULTS: Record<NetworkName, { passphrase: string; rpc: string[]; horizon: string[] }> = {
  // SDF runs no public mainnet RPC. These are free public endpoints run by providers; set
  // CONCORD_MAINNET_RPC_URLS to a paid one for anything beyond light use.
  mainnet: {
    passphrase: "Public Global Stellar Network ; September 2015",
    rpc: [
      "https://mainnet.sorobanrpc.com",
      "https://soroban-rpc.mainnet.stellar.gateway.fm",
      "https://rpc.ankr.com/stellar_soroban",
    ],
    horizon: ["https://horizon.stellar.org"],
  },
  testnet: {
    passphrase: "Test SDF Network ; September 2015",
    rpc: ["https://soroban-testnet.stellar.org"],
    horizon: ["https://horizon-testnet.stellar.org"],
  },
};

export interface Config {
  networks: Record<NetworkName, NetworkConfig>;
  /** The network a new workspace opens on. */
  defaultNetwork: NetworkName;
  /** Holds control.db and one database per workspace under orgs/. */
  dataDir: string;
  host: string;
  port: number;
  /** Seconds between indexer passes. 0 disables the background indexer. */
  syncIntervalSec: number;
  webDir: string;
  /** The origin users reach the service on. Decides cookie flags and the OAuth redirect. */
  publicUrl: string;
  /** Reverse proxies in front of the server whose X-Forwarded-For entry can be believed. */
  trustProxyHops: number;
  /** "open": anyone may create a workspace. "code": only with an operator-issued code. */
  signup: "open" | "code";
  maxAssetsPerOrg: number;
  /** Pending invitations one workspace may hold at once. */
  maxInvitesPerOrg: number;
  /** The host discards the data directory on restart. Shown to users rather than hidden. */
  ephemeral: boolean;
  google?: { clientId: string; clientSecret: string };
  /** scrypt work factors for new password hashes. Unset keeps the built-in default. */
  passwordCost?: { N: number; r: number; p: number };
}

/** Removed settings. Naming them stops a stale environment from being silently half-applied. */
const RETIRED: Record<string, string> = {
  CONCORD_NETWORK: "both networks are always served; nothing replaces it",
  CONCORD_RPC_URL: "use CONCORD_MAINNET_RPC_URLS or CONCORD_TESTNET_RPC_URLS",
  CONCORD_HORIZON_URL: "use CONCORD_MAINNET_HORIZON_URLS or CONCORD_TESTNET_HORIZON_URLS",
  CONCORD_DB: "use CONCORD_DATA_DIR; each workspace has its own database under it",
  CONCORD_API_TOKEN: "users sign in; there is no shared token",
};

/** Recognized runtime settings, including the CLI-only workspace selector. */
const KNOWN_CONCORD_SETTINGS = [
  "CONCORD_DATA_DIR", "CONCORD_DEFAULT_NETWORK", "CONCORD_EPHEMERAL",
  "CONCORD_GOOGLE_CLIENT_ID", "CONCORD_GOOGLE_CLIENT_SECRET", "CONCORD_HOST",
  "CONCORD_MAINNET_HORIZON_URLS", "CONCORD_MAINNET_RPC_URLS",
  "CONCORD_MAX_ASSETS", "CONCORD_MAX_INVITES", "CONCORD_ORG", "CONCORD_PASSWORD_COST",
  "CONCORD_PORT", "CONCORD_PUBLIC_URL", "CONCORD_RPC_HEADERS",
  "CONCORD_SIGNUP", "CONCORD_SYNC_INTERVAL", "CONCORD_TESTNET_HORIZON_URLS",
  "CONCORD_TESTNET_RPC_URLS", "CONCORD_TRUST_PROXY", "CONCORD_USER_AGENT_SUFFIX", "CONCORD_WEB_DIR",
] as const;
const KNOWN_SETTINGS = new Set<string>(KNOWN_CONCORD_SETTINGS);

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1,
        previous[j - 1]! + Number(a[i - 1] !== b[j - 1]));
    }
    previous = current;
  }
  return previous[b.length]!;
}

function warnUnknownSettings(env: NodeJS.ProcessEnv, warn: (message: string) => void): void {
  for (const name of Object.keys(env)) {
    if (!name.startsWith("CONCORD_") || KNOWN_SETTINGS.has(name) || name in RETIRED) continue;
    const closest = [...KNOWN_SETTINGS].map((candidate) => ({
      candidate, distance: editDistance(name, candidate),
    })).sort((a, b) => a.distance - b.distance)[0];
    const suggestion = closest && closest.distance <= 4 ? `; did you mean ${closest.candidate}?` : "";
    warn(`Unknown Concord setting ${name}${suggestion}`);
  }
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 0, max?: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    if (max !== undefined) {
      throw new Error(`${name} must be a whole number from ${min} to ${max}`);
    }
    throw new Error(`${name} must be a whole number of at least ${min}`);
  }
  return n;
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback = false): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  throw new Error(`${name} must be a boolean flag: 1/true/yes/on or 0/false/no/off`);
}

function endpoints(urls: string[], headers: Record<string, Record<string, string>>, name: string): Endpoint[] {
  return urls.map((url) => {
    let host: string;
    let hostname: string;
    let hasCredentials = false;
    try {
      const parsed = new URL(url);
      hasCredentials = Boolean(parsed.username || parsed.password);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("not http");
      host = parsed.host;
      hostname = parsed.hostname;
    } catch {
      throw new Error(`${name} holds something that is not a URL`);
    }
    if (hasCredentials) {
      throw new Error(`${name} must not contain URL credentials; configure Authorization via CONCORD_RPC_HEADERS`);
    }
    const endpoint: Endpoint = { url: url.replace(/\/+$/, "") };
    const h = headers[host] ?? headers[hostname];
    if (h) endpoint.headers = h;
    return endpoint;
  });
}

/** The repository root in a checkout, /app in the container. */
const ROOT = resolve(import.meta.dirname, "../../..");

export function loadConfig(env: NodeJS.ProcessEnv = process.env, warn: (message: string) => void = console.warn): Config {
  if (env === process.env) {
    try {
      // A .env beside package.json, when there is one. Variables already set take precedence.
      process.loadEnvFile(resolve(ROOT, ".env"));
    } catch (err) {
      // A missing .env is optional, but permission and parsing errors are configuration failures.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Failed to load .env: ${(err as Error).message}`, { cause: err });
      }
    }
  }
  for (const [name, advice] of Object.entries(RETIRED)) {
    if (env[name]) throw new Error(`${name} is no longer read: ${advice}`);
  }

  warnUnknownSettings(env, warn);

  if (env.CONCORD_USER_AGENT_SUFFIX && !/^[\x20-\x7e]{1,120}$/.test(env.CONCORD_USER_AGENT_SUFFIX)) {
    throw new Error("CONCORD_USER_AGENT_SUFFIX must be at most 120 printable ASCII characters");
  }

  let headers: Record<string, Record<string, string>> = {};
  if (env.CONCORD_RPC_HEADERS) {
    try {
      const parsed = JSON.parse(env.CONCORD_RPC_HEADERS);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error();
      }
      for (const hostHeaders of Object.values(parsed)) {
        if (typeof hostHeaders !== "object" || hostHeaders === null || Array.isArray(hostHeaders)) {
          throw new Error();
        }
        for (const val of Object.values(hostHeaders)) {
          if (typeof val !== "string") {
            throw new Error();
          }
        }
      }
      headers = parsed as Record<string, Record<string, string>>;
    } catch {
      throw new Error('CONCORD_RPC_HEADERS must be JSON: {"host": {"header": "value"}}');
    }
  }
  const network = (name: NetworkName): NetworkConfig => {
    const upper = name.toUpperCase();
    const base = DEFAULTS[name];
    const rpc = list(env[`CONCORD_${upper}_RPC_URLS`]);
    const horizon = list(env[`CONCORD_${upper}_HORIZON_URLS`]);
    return {
      name,
      passphrase: base.passphrase,
      rpc: endpoints(rpc.length ? rpc : base.rpc, headers, `CONCORD_${upper}_RPC_URLS`),
      horizon: endpoints(horizon.length ? horizon : base.horizon, headers, `CONCORD_${upper}_HORIZON_URLS`),
      ...(env.CONCORD_USER_AGENT_SUFFIX ? { userAgentSuffix: env.CONCORD_USER_AGENT_SUFFIX } : {}),
    };
  };

  const defaultNetwork = env.CONCORD_DEFAULT_NETWORK ?? "mainnet";
  if (!isNetworkName(defaultNetwork)) throw new Error("CONCORD_DEFAULT_NETWORK must be mainnet or testnet");
  const signup = env.CONCORD_SIGNUP ?? "open";
  if (signup !== "open" && signup !== "code") throw new Error("CONCORD_SIGNUP must be open or code");

  // Hosts such as Render hand the port over as PORT.
  const port = integer(env, env.CONCORD_PORT ? "CONCORD_PORT" : "PORT", 4400, 1, 65535);
  const host = env.CONCORD_HOST ?? "127.0.0.1";
  const urlHost =
    host === "0.0.0.0" || host === "::"
      ? "127.0.0.1"
      : host.includes(":") && !host.startsWith("[")
        ? `[${host}]`
        : host;
  // Render names the service's own address in RENDER_EXTERNAL_URL.
  let publicUrl = env.CONCORD_PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://${urlHost}:${port}`;
  let parsedPublicUrl: URL;
  try {
    parsedPublicUrl = new URL(publicUrl);
  } catch {
    throw new Error("CONCORD_PUBLIC_URL must be a URL such as https://concord.example.com");
  }
  // Everything past the origin used to be dropped silently (…/concord became
  // the bare origin), so cookies, the Google redirect URI and invite links on
  // a sub-path deployment pointed at the wrong place with no explanation.
  // Concord serves from "/", so a sub-path is a configuration error worth
  // naming, not trimming. A bare trailing slash parses to pathname "/" and
  // stays accepted.
  if (parsedPublicUrl.pathname !== "/" || parsedPublicUrl.search !== "" || parsedPublicUrl.hash !== "") {
    throw new Error(
      `CONCORD_PUBLIC_URL must not carry a path, query or fragment — Concord serves from the root ` +
        `and sub-path hosting is not supported. Got "${publicUrl}"; use "${parsedPublicUrl.origin}".`,
    );
  }
  publicUrl = parsedPublicUrl.origin;

  const config: Config = {
    networks: { mainnet: network("mainnet"), testnet: network("testnet") },
    defaultNetwork,
    dataDir: env.CONCORD_DATA_DIR ? resolve(ROOT, env.CONCORD_DATA_DIR) : resolve(ROOT, "data"),
    host,
    port,
    syncIntervalSec: integer(env, "CONCORD_SYNC_INTERVAL", 30),
    webDir: env.CONCORD_WEB_DIR ? resolve(ROOT, env.CONCORD_WEB_DIR) : resolve(ROOT, "apps/web/dist"),
    publicUrl,
    trustProxyHops: integer(env, "CONCORD_TRUST_PROXY", 0, 0, 10),
    signup,
    maxAssetsPerOrg: integer(env, "CONCORD_MAX_ASSETS", 10, 1, 1000),
    maxInvitesPerOrg: integer(env, "CONCORD_MAX_INVITES", 100, 1, 10000),
    ephemeral: flag(env, "CONCORD_EPHEMERAL", false),
  };
  if (env.CONCORD_PASSWORD_COST) {
    // N:r:p. Each stored hash carries the factors it was made with, so this can change at any time.
    const [N, r, p] = env.CONCORD_PASSWORD_COST.split(":").map(Number);
    const whole = (n: number | undefined, min: number, max: number) => Number.isInteger(n) && n! >= min && n! <= max;
    if (!whole(N, 2 ** 14, 2 ** 20) || (N! & (N! - 1)) !== 0 || !whole(r, 8, 32) || !whole(p, 1, 16)) {
      throw new Error("CONCORD_PASSWORD_COST must be N:r:p, with N a power of two from 16384, r from 8 and p from 1; e.g. 32768:8:3");
    }
    const scryptMemoryBytes = 128 * N! * r!;
    if (scryptMemoryBytes > 128 * 1024 * 1024) {
      throw new Error("CONCORD_PASSWORD_COST cannot exceed 128 MiB of scrypt memory");
    }
    config.passwordCost = { N: N!, r: r!, p: p! };
  }
  const clientId = env.CONCORD_GOOGLE_CLIENT_ID;
  const clientSecret = env.CONCORD_GOOGLE_CLIENT_SECRET;
  if (clientId || clientSecret) {
    if (!clientId || !clientSecret) {
      throw new Error("set both CONCORD_GOOGLE_CLIENT_ID and CONCORD_GOOGLE_CLIENT_SECRET, or neither");
    }
    config.google = { clientId, clientSecret };
  }
  return config;
}
