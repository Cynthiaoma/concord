import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/security.js";
import { Client, harness } from "./helpers.js";

describe("email lockout versus shared IP sign-in budget", () => {
  it("rejects locked accounts before charging the shared IP allowance", async () => {
    const limiter = new RateLimiter();
    const h = harness({ limiter });
    const client = new Client(h.app);
    const email = "locked@example.test";
    const failures = "signin-failed:" + email;
    for (let i = 0; i < 10; i++) limiter.hit(failures, 10, 15 * 60_000);
    const hit = vi.spyOn(limiter, "hit");
    const locked = await client.call("/api/auth/signin", {
      body: { email, password: "wrong password" },
    });
    expect(locked.status).toBe(429);
    expect(hit.mock.calls.some(([key]) => key.startsWith("signin:"))).toBe(false);

    const normal = await client.call("/api/auth/signin", {
      body: { email: "another@example.test", password: "wrong password" },
    });
    expect(normal.status).toBe(401);
    expect(hit.mock.calls.some(([key]) => key.startsWith("signin:"))).toBe(true);
  });
});
