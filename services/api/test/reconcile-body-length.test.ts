import { describe, expect, it, vi } from "vitest";
import { Client, harness } from "./helpers.js";

describe("reconcile POST without content-length", () => {
  it("honors registerId in JSON body and preserves empty-body latest behavior", async () => {
    const h = harness();
    const c = await new Client(h.app).signUp("length@example.test", "Length");
    const ws = h.tenants.forOrg(c.orgId);
    const reconcile = vi.spyOn(ws, "reconcile").mockImplementation(async (_asset, registerId) =>
      ({ id: 42, registerId }) as never);
    const chosen = await c.call("/api/assets/ASSET/reconciliations", { body: { registerId: 7 } });
    expect(chosen.status).toBe(201);
    expect(reconcile).toHaveBeenCalledWith("ASSET", 7, expect.objectContaining({ id: c.userId }));
    const empty = await c.call("/api/assets/ASSET/reconciliations", { method: "POST" });
    expect(empty.status).toBe(201);
    expect(reconcile).toHaveBeenLastCalledWith("ASSET", undefined, expect.anything());
  });

  it("rejects a nonnumeric registerId", async () => {
    const h = harness();
    const c = await new Client(h.app).signUp("invalid@example.test", "Length");
    const response = await c.call("/api/assets/ASSET/reconciliations", { body: { registerId: "7" } });
    expect(response.status).toBe(400);
  });
});