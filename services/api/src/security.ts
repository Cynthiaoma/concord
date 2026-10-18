import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A secret for a cookie or a link. Only its hash is ever stored. */
export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Sixteen hex characters. Safe to use in a file name. */
export const newId = () => randomBytes(8).toString("hex");

export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ── passwords ───────────────────────────────────────────────────────────────

export interface ScryptCost {
  /** CPU and memory cost; a power of two. */
  N: number;
  r: number;
  p: number;
}

/** OWASP's N=2^15, r=8, p=3. The cost travels in each hash, so it can be raised later. */
export const DEFAULT_COST: ScryptCost = { N: 2 ** 15, r: 8, p: 3 };

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

// scrypt runs on the thread pool DNS lookups also use; a burst of sign-ins must not starve the
// indexer's requests.
const SLOTS = 2;
let busy = 0;
const waiting: Array<() => void> = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (busy >= SLOTS) await new Promise<void>((resolve) => waiting.push(resolve));
  busy++;
  try {
    return await work();
  } finally {
    busy--;
    waiting.shift()?.();
  }
}

function derive(password: string, salt: Buffer, cost: ScryptCost, length: number): Promise<Buffer> {
  return slot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        // Node's default memory ceiling rejects N=2^15.
        scrypt(password.normalize("NFKC"), salt, length, { ...cost, maxmem: 256 * cost.N * cost.r }, (err, key) =>
          err ? reject(err) : resolve(key),
        );
      }),
  );
}

export async function hashPassword(password: string, cost: ScryptCost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost, 32);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) return false;
  const key = await derive(password, Buffer.from(salt, "base64url"), cost, expected.length);
  return timingSafeEqual(key, expected);
}

// ── signed values ───────────────────────────────────────────────────────────

/** Signs short-lived cookie payloads so a value planted from elsewhere is refused. */
export class Signer {
  constructor(private readonly secret: Buffer = randomBytes(32)) {}

  seal(value: unknown): string {
    const body = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${body}.${createHmac("sha256", this.secret).update(body).digest("base64url")}`;
  }

  open<T>(sealed: string | undefined): T | undefined {
    const [body, mac] = (sealed ?? "").split(".");
    if (!body || !mac) return undefined;
    if (!sameText(mac, createHmac("sha256", this.secret).update(body).digest("base64url"))) return undefined;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    } catch {
      return undefined;
    }
  }
}

// ── rate limiting ───────────────────────────────────────────────────────────

/** Fixed windows held in memory. One process serves everything, so that is enough. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  /** Counts one attempt. Returns 0 when allowed, else the seconds to wait. */
  hit(key: string, limit: number, windowMs: number): number {
    const at = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= at) {
      if (this.windows.size > 50_000) this.sweep(true);
      w = { count: 0, resetAt: at + windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return w.count > limit ? Math.max(1, Math.ceil((w.resetAt - at) / 1000)) : 0;
  }

  /** Seconds left on a key that is already over its limit, without counting an attempt. */
  blocked(key: string, limit: number): number {
    const w = this.windows.get(key);
    const at = this.now();
    return w && w.resetAt > at && w.count >= limit ? Math.max(1, Math.ceil((w.resetAt - at) / 1000)) : 0;
  }

  clear(key: string): void {
    this.windows.delete(key);
  }

  private sweep(force = false): void {
    const at = this.now();
    for (const [key, w] of this.windows) if (w.resetAt <= at) this.windows.delete(key);
    if (force && this.windows.size > 50_000) this.windows.clear();
  }
}

export class TooMany extends Error {
  constructor(readonly retryAfter: number) {
    super(`Too many attempts. Try again in ${retryAfter < 90 ? `${retryAfter} seconds` : `${Math.ceil(retryAfter / 60)} minutes`}.`);
  }
}
