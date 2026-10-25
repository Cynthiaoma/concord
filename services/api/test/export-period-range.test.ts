import { describe, expect, it } from "vitest";
import { Client, harness, key } from "./helpers.js";

describe("audit export period", () => {
  it("rejects inverted from/to rather than exporting an empty audit pack", async () => {
    const h = harness();
    const client = await new Client(h.app).signUp("period@example.test", "Period tests");
    const ws = h.tenants.forOrg(client.orgId);
    const watched = await ws.watchAsset({ network: "testnet", asset: "PERIOD:" + key(), fromLedger: 1 });
    const url = "/api/assets/" + watched.code + "/export?from=2026-10-04T00%3A00%3A00Z&to=2026-10-03T00%3A00%3A00Z";
    const invalid = await client.call(url);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "from must not be after to" });
  });
});
