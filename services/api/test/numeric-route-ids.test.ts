import { describe, expect, it, vi } from "vitest";
import { Client, harness } from "./helpers.js";

describe("strict numeric API route IDs", () => {
  it("rejects alternate encodings before looking up reconciliation runs", async () => {
    const h = harness();
    const client = await new Client(h.app).signUp("id@example.test", "IDs");
    const ws = h.tenants.forOrg(client.orgId);
    const run = vi.spyOn(ws, "run");
    for (const id of ["0x10", "1e0", "1.0", "01", "%201", "-1", "0", "1e5", "12345678901"]) {
      const response = await client.call("/api/reconciliations/" + id);
      expect(response.status, id).toBe(404);
    }
    expect(run).not.toHaveBeenCalled();
    expect((await client.call("/api/reconciliations/1")).status).toBe(404);
    expect(run).toHaveBeenCalledWith(1);
  });
});