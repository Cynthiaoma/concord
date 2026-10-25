import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Signer } from "../src/security.js";

describe("signed OAuth state expiry", () => {
  it("rejects a valid HMAC after the signed ten-minute lifetime, independent of the cookie", () => {
    let time = 1_800_000_000_000;
    const signer = new Signer(Buffer.alloc(32, 7), () => time);
    const state = { state: "random-oauth-state", nonce: "nonce", verifier: "verifier" };
    const sealed = signer.seal(state);
    expect(signer.open<typeof state>(sealed)).toEqual(state);
    time += 599_999;
    expect(signer.open<typeof state>(sealed)).toEqual(state);
    time += 1;
    expect(signer.open<typeof state>(sealed)).toBeUndefined();
  });

  it("rejects tampering and a correctly signed legacy value without an expiry", () => {
    const signer = new Signer(Buffer.alloc(32, 7));
    const cookie = signer.seal({ state: "valid" });
    const [body, mac] = cookie.split(".");
    expect(signer.open(body + "." + mac?.replace(/^./, mac[0] === "a" ? "b" : "a"))).toBeUndefined();
    const legacyBody = Buffer.from(JSON.stringify({ state: "legacy" })).toString("base64url");
    const legacyMac = createHmac("sha256", Buffer.alloc(32, 7)).update(legacyBody).digest("base64url");
    expect(signer.open(legacyBody + "." + legacyMac)).toBeUndefined();
    expect(signer.open("")).toBeUndefined();
  });
});
