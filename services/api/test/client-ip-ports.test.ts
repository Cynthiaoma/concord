import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIp } from "../src/auth-api.js";

describe("trusted proxy IP rate-limit bucket", () => {
  it.each([
    ["1.2.3.4:5555", "1.2.3.4"],
    ["1.2.3.4", "1.2.3.4"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["2001:db8::1", "2001:db8::1"],
  ])("normalizes %s into %s", async (forwarded, expected) => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientIp(c, 1)));
    const response = await app.request("/", { headers: { "x-forwarded-for": forwarded } });
    expect(await response.text()).toBe(expected);
  });

  it("rejects malformed forwarded headers as rate-limit identities", async () => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientIp(c, 1)));
    const response = await app.request("/", { headers: { "x-forwarded-for": "1.2.3.999:443" } });
    expect(await response.text()).toBe("unknown");
  });
});