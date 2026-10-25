import { describe, expect, it } from "vitest";
import { Client, harness } from "./helpers.js";

describe("self-leave account protection", () => {
  it("keeps a member's login when it is their only workspace", async () => {
    const h = harness();
    const owner = await new Client(h.app).signUp("owner@example.test", "Team");
    const invite = await owner.json<{ link: string }>("/api/org/invites", {
      body: { email: "member@example.test" },
    });
    const member = new Client(h.app);
    const joined = await member.json<{ user: { id: string } }>("/api/auth/invites/accept", {
      body: { token: invite.link.split("/#/invite/")[1], name: "Member", password: "correct horse battery" },
    });
    const result = await member.call("/api/org/members/" + joined.user.id, { method: "DELETE" });
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "You cannot leave your only workspace. Join another first." });
    expect((await member.call("/api/auth/me")).status).toBe(200);
    expect((await member.call("/api/overview")).status).toBe(200);
  });
});
