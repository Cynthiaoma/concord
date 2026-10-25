import { describe, expect, it } from "vitest";
import { Client, harness } from "./helpers.js";

describe("RPC reconciliation rate limits", () => {
  it("shares a bounded quota across reconciliation routes without limiting other users", async () => {
    const h = harness();
    const a = await new Client(h.app).signUp("a@example.test", "A");
    const b = await new Client(h.app).signUp("b@example.test", "B");
    for (let i = 0; i < 20; i++) {
      const route = i % 2 ? "/api/actions/999/reconcile" : "/api/assets/UNKNOWN/reconciliations";
      const response = await a.call(route, { method: "POST" });
      expect(response.status).toBe(404);
    }
    const blocked = await a.call("/api/assets/UNKNOWN/reconciliations", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await b.call("/api/assets/UNKNOWN/reconciliations", { method: "POST" })).status).toBe(404);
  });
});
