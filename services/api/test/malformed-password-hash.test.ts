import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/security.js";
import { Client, harness } from "./helpers.js";

describe("malformed password hashes", () => {
  it("rejects invalid cost parameters and encodings instead of throwing", async () => {
    const valid = await hashPassword("correct horse battery", { N: 2 ** 12, r: 8, p: 1 });
    expect(await verifyPassword("correct horse battery", valid)).toBe(true);
    const [scheme, , , , salt, hash] = valid.split("$");
    for (const invalid of [
      `${scheme}$3$8$1$${salt}$${hash}`,
      `${scheme}$99999999999$8$1$${salt}$${hash}`,
      `${scheme}$4096$0$1$${salt}$${hash}`,
      `${scheme}$4096$8$-1$${salt}$${hash}`,
      `${scheme}$4096$8$1$invalid$${hash}`,
      `${scheme}$4096$8$1$${salt}$invalid`,
      "not-a-password-hash",
    ]) {
      await expect(verifyPassword("correct horse battery", invalid)).resolves.toBe(false);
    }
  });

  it("returns 401 when a stored credential has invalid scrypt parameters", async () => {
    const h = harness();
    const c = await new Client(h.app).signUp("hash@example.test", "Hash test");
    h.control.write("UPDATE credentials SET secret = ? WHERE user_id = ? AND kind = 'password'",
      "scrypt$3$8$1$invalid$invalid", c.userId);
    const another = new Client(h.app);
    const response = await another.call("/api/auth/signin", { body: {
      email: "hash@example.test", password: "correct horse battery",
    }});
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Wrong email or password." });
  });
});