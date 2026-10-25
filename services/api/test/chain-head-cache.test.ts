import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { StellarSource } from "../src/chain.js";

const config = () => loadConfig({ CONCORD_MAINNET_RPC_URLS: "https://rpc.example" }).networks.mainnet;
const health = (latest: number) => new Response(JSON.stringify({
  jsonrpc: "2.0", result: { latestLedger: latest, oldestLedger: 1 },
}));

describe("StellarSource getHealth single-flight cache", () => {
  it("shares one pending request among simultaneous consumers", async () => {
    let requests = 0;
    let release!: (response: Response) => void;
    const fetcher = (async () => {
      requests++;
      return new Promise<Response>((resolve) => { release = resolve; });
    }) as typeof fetch;
    const source = new StellarSource(config(), { fetch: fetcher, now: () => 1000 });
    const first = source.latestLedger();
    const second = source.latestLedger();
    const third = source.latestLedger();
    expect(requests).toBe(1);
    release(health(45));
    const results = await Promise.all([first, second, third]);
    expect(results.map((head) => head.latest)).toEqual([45, 45, 45]);
    expect(requests).toBe(1);
  });

  it("expires the cache after two seconds using the injected clock", async () => {
    let requests = 0;
    let now = 1000;
    const fetcher = (async () => health(++requests)) as typeof fetch;
    const source = new StellarSource(config(), { fetch: fetcher, now: () => now });
    expect((await source.latestLedger()).latest).toBe(1);
    now += 1_999;
    expect((await source.latestLedger()).latest).toBe(1);
    expect(requests).toBe(1);
    now += 2;
    expect((await source.latestLedger()).latest).toBe(2);
    expect(requests).toBe(2);
  });

  it("does not cache a rejected getHealth call", async () => {
    let requests = 0;
    const fetcher = (async () => ++requests === 1
      ? new Response("", { status: 400 })
      : health(99)) as typeof fetch;
    const source = new StellarSource(config(), { fetch: fetcher, now: () => 1000 });
    await expect(source.latestLedger()).rejects.toThrow(/HTTP 400/);
    expect((await source.latestLedger()).latest).toBe(99);
    expect(requests).toBe(2);
  });
});
