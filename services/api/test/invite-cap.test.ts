import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Client, harness } from "./helpers.js";

describe("pending invitation cap", () => {
  it("limits distinct active invites but permits replacement and revocation", async () => {
    const h = harness({}, undefined, { maxInvites: 2 });
    const owner = await new Client(h.app).signUp("owner@example.test", "Limited");
    const create = async (email: string) =>
      owner.call("/api/org/invites", { body: { email, role: "member" } });
    expect((await create("a@example.test")).status).toBe(201);
    expect((await create("b@example.test")).status).toBe(201);
    const blocked = await create("c@example.test");
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: "A workspace can have at most 2 pending invitations." });
    expect((await create("a@example.test")).status).toBe(201);
    const invites = await owner.json<{ invites: Array<{ id: string; email: string }> }>("/api/org/members");
    expect(invites.invites).toHaveLength(2);
    const id = invites.invites.find((invite) => invite.email === "a@example.test")!.id;
    expect((await owner.call("/api/org/invites/" + id, { method: "DELETE" })).status).toBe(200);
    expect((await create("c@example.test")).status).toBe(201);
  });
});

describe("CONCORD_MAX_INVITES", () => {
  it("defaults to 100 and accepts whole numbers from 1 to 10000", () => {
    expect(loadConfig({}).maxInvitesPerOrg).toBe(100);
    expect(loadConfig({ CONCORD_MAX_INVITES: "1" }).maxInvitesPerOrg).toBe(1);
    expect(loadConfig({ CONCORD_MAX_INVITES: "10000" }).maxInvitesPerOrg).toBe(10000);
  });

  it.each(["0", "-1", "1.5", "many", "10001"])("rejects %s rather than falling back silently", (value) => {
    expect(() => loadConfig({ CONCORD_MAX_INVITES: value })).toThrow(/CONCORD_MAX_INVITES/);
  });
});
