import { describe, expect, it } from "vitest";
import { Client, harness } from "./helpers.js";

describe("browser workspace context guard", () => {
  it("rejects state changes lacking x-concord-org for browser requests", async () => {
    const h = harness();
    const client = await new Client(h.app).signUp("browser@example.test", "Browser Inc");
    const missing = await client.call("/api/org", {
      method: "PATCH",
      body: { name: "Should not change" },
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({
      error: "This browser tab is missing its workspace context. Reload it.",
    });
    const correct = await client.call("/api/org", {
      method: "PATCH",
      body: { name: "Valid change" },
      headers: { "sec-fetch-site": "same-origin", "x-concord-org": client.orgId },
    });
    expect(correct.status).toBe(200);
    const get = await client.call("/api/overview", { headers: { "sec-fetch-site": "same-origin" } });
    expect(get.status).toBe(200);
  });

  it("preserves programmatic clients without sec-fetch-site", async () => {
    const h = harness();
    const client = await new Client(h.app).signUp("script@example.test", "Scripts");
    const res = await client.call("/api/org", { method: "PATCH", body: { name: "Automation" } });
    expect(res.status).toBe(200);
  });
});
