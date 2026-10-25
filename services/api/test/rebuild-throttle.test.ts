import { describe, expect, it, vi } from "vitest";
import type { RateLimiter } from "../src/security.js";
import { Client, harness, key } from "./helpers.js";

describe("separate watch and rebuild quotas", () => {
  it("uses independent throttle keys so rebuilding does not consume watch quota", async () => {
    const hit = vi.fn(() => 0);
    const h = harness({ limiter: { hit } as unknown as RateLimiter });
    h.chain.baselineResult = { ledger: 50, openings: new Map() };
    const client = await new Client(h.app).signUp("rebuild@example.test", "Rebuild test");
    const watch = await client.call("/api/assets", {
      body: { network: "testnet", asset: "RATE:" + key() },
    });
    expect(watch.status).toBe(201);
    await client.call("/api/assets/RATE/rebuild", { method: "POST" });
    const keys = hit.mock.calls.map(([value]) => value);
    expect(keys).toContain("watch:" + client.userId);
    expect(keys).toContain("rebuild:" + client.userId);
  });
});
