import { describe, expect, it } from "vitest";
import { Client, harness } from "./helpers.js";

describe("email address validation", () => {
  it.each([
    "a@b.c.", "a@b..c", "a@.b.c", "a@-b.com",
    '"a"@b.com', "ａ@example.test", "a..b@example.test",
    "a@example..test", "a@b-.com", "a@example.t",
  ])("rejects malformed signup address %s", async (email) => {
    const h = harness();
    const c = new Client(h.app);
    const response = await c.call("/api/auth/signup", {
      body: { email, name: "Test", orgName: "Team", password: "correct horse battery" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Enter a valid email address." });
  });

  it("still accepts plus-tagged and dotted addresses", async () => {
    const h = harness();
    const c = new Client(h.app);
    const response = await c.call("/api/auth/signup", {
      body: { email: "first.last+tag@example.test", name: "Test",
        orgName: "Team", password: "correct horse battery" },
    });
    expect(response.status).toBe(201);
  });
});