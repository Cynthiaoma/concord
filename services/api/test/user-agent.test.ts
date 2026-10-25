import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { StellarSource } from "../src/chain.js";

describe("outbound provider User-Agent", () => {
  it("identifies the package version on RPC and Horizon, with an optional operator suffix", async () => {
    const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
    const requests: Array<{ url: string; agent: string }> = [];
    const fetcher = (async (url: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      requests.push({ url: String(url), agent: headers["user-agent"] });
      const body = String(url).includes("/assets?")
        ? { _embedded: { records: [] } }
        : { jsonrpc: "2.0", result: { latestLedger: 25, oldestLedger: 1 } };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const config = loadConfig({
      CONCORD_MAINNET_RPC_URLS: "https://rpc.example",
      CONCORD_MAINNET_HORIZON_URLS: "https://horizon.example",
      CONCORD_USER_AGENT_SUFFIX: "operator@example.com",
    });
    const source = new StellarSource(config.networks.mainnet, { fetch: fetcher });
    expect((await source.latestLedger()).latest).toBe(25);
    expect(await source.search("TEST")).toEqual([]);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.agent).toContain(`concord/${version}`);
      expect(request.agent).toContain("https://github.com/useconcord/concord");
      expect(request.agent).toContain("operator@example.com");
    }
  });

  it("rejects newline injection and overlong operator suffixes", () => {
    expect(() => loadConfig({ CONCORD_USER_AGENT_SUFFIX: "ok\r\nx-evil: injected" })).toThrow(/CONCORD_USER_AGENT_SUFFIX/);
    expect(() => loadConfig({ CONCORD_USER_AGENT_SUFFIX: "a".repeat(121) })).toThrow(/CONCORD_USER_AGENT_SUFFIX/);
  });
});
