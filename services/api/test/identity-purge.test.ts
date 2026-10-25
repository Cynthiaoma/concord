import { describe, expect, it } from "vitest";
import { Client, harness } from "./helpers.js";

const DAY = 86_400_000;

describe("purging expired identity records", () => {
  it("removes expired sessions and invites but retains unexpired tokens", async () => {
    const h = harness();
    const owner = await new Client(h.app).signUp("cleanup@example.test", "Cleanup");
    await owner.json("/api/org/invites", { body: { email: "invite@example.test" } });
    h.auth.createSignupCode("still valid");
    expect(h.control.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")?.n).toBe(1);
    expect(h.control.get<{ n: number }>("SELECT COUNT(*) AS n FROM invites")?.n).toBe(1);
    h.now.value += 8 * DAY;
    expect(h.auth.purgeExpired()).toEqual({ sessions: 1, invites: 1, tokens: 0 });
    expect(h.control.get<{ n: number }>("SELECT COUNT(*) AS n FROM one_time_tokens")?.n).toBe(1);
    h.now.value += 7 * DAY;
    expect(h.auth.purgeExpired()).toEqual({ sessions: 0, invites: 0, tokens: 1 });
    expect(h.auth.purgeExpired()).toEqual({ sessions: 0, invites: 0, tokens: 0 });
  });

  it("removes consumed one-time tokens before their expiry", () => {
    const h = harness();
    const code = h.auth.createSignupCode("spent");
    expect(code.length).toBeGreaterThan(0);
    h.control.write("UPDATE one_time_tokens SET used_at = ?", new Date(h.now.value).toISOString());
    expect(h.auth.purgeExpired()).toEqual({ sessions: 0, invites: 0, tokens: 1 });
  });
});
