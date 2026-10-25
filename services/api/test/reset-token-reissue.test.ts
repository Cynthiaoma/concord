import { describe, expect, it } from "vitest";
import { Client, harness } from "./helpers.js";

describe("reset token invalidation", () => {
  it("revokes older links when a new password reset link is issued", async () => {
    const h = harness();
    await new Client(h.app).signUp("reset@example.test", "Reset test");
    const first = h.auth.createResetToken("reset@example.test");
    const second = h.auth.createResetToken("reset@example.test");
    await expect(h.auth.resetPassword(first, "different secure password")).rejects.toThrow(
      "This reset link is no longer valid.",
    );
    await expect(h.auth.resetPassword(second, "different secure password")).resolves.toHaveProperty("userId");
    const unused = h.control.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM one_time_tokens WHERE purpose = 'reset' AND used_at IS NULL",
    );
    expect(unused?.n).toBe(0);
    await expect(h.auth.resetPassword(second, "yet another secure password")).rejects.toThrow(
      "This reset link is no longer valid.",
    );
  });
});
