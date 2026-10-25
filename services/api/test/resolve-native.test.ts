import { Asset, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { resolveAsset } from "../src/chain.js";
import { MAINNET_PASSPHRASE, PASSPHRASE } from "./helpers.js";

describe("native Stellar assets and contract ids", () => {
  it.each([PASSPHRASE, MAINNET_PASSPHRASE])("resolves native and XLM against the chosen passphrase", (passphrase) => {
    const id = Asset.native().contractId(passphrase);
    expect(resolveAsset("native", passphrase)).toEqual({ id, code: "XLM" });
    expect(resolveAsset(" XlM ", passphrase)).toEqual({ id, code: "XLM" });
  });

  it("normalizes lowercase contract ids without changing their valid checksum", () => {
    const id = Asset.native().contractId(PASSPHRASE);
    expect(StrKey.isValidContract(id)).toBe(true);
    expect(resolveAsset(id.toLowerCase(), PASSPHRASE)).toEqual({
      id,
      code: `${id.slice(0, 4)}…${id.slice(-4)}`,
    });
    expect(resolveAsset(id, PASSPHRASE).id).toBe(id);
  });

  it("keeps invalid identifiers rejected", () => {
    expect(() => resolveAsset("native:not-valid", PASSPHRASE)).toThrow(/asset must be/i);
    expect(() => resolveAsset("cINVALID", PASSPHRASE)).toThrow(/asset must be/i);
  });
});
