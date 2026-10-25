import { describe, expect, it, vi } from "vitest";
import { harness } from "./helpers.js";

describe("health probe", () => {
  it("queries control SQLite without enumerating workspace IDs", async () => {
    const h = harness();
    const get = vi.spyOn(h.control, "get");
    const enumerate = vi.spyOn(h.auth, "orgIds").mockImplementation(() => {
      throw new Error("health must not enumerate workspaces");
    });
    const res = await h.app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(get.mock.calls.some(([sql]) => sql === "SELECT 1")).toBe(true);
    expect(enumerate).not.toHaveBeenCalled();
  });
});
