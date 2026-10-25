import { describe, expect, it } from "vitest";
import { Client, harness } from "./helpers.js";

describe("session rotation on re-authentication", () => {
  it("revokes the previous cookie on signing in again", async () => {
    const h = harness();
    const client = await new Client(h.app).signUp("again@example.test", "Session test");
    const previous = client.cookies.get("concord_session");
    expect(previous).toBeTruthy();

    const result = await client.call("/api/auth/signin", {
      body: { email: "again@example.test", password: "correct horse battery" },
    });
    expect(result.status).toBe(200);
    expect(client.cookies.get("concord_session")).not.toBe(previous);
    const stale = new Client(h.app);
    stale.cookies.set("concord_session", previous!);
    expect((await stale.call("/api/auth/me")).status).toBe(401);
    expect((await client.call("/api/auth/me")).status).toBe(200);
    expect(h.control.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")?.n).toBe(1);
  });
});