import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("operator configuration safety ceilings", () => {
  it.each([
    ["CONCORD_TRUST_PROXY", "10", 10],
    ["CONCORD_MAX_ASSETS", "1000", 1000],
  ])("accepts the documented upper limit for %s", (name, value, expected) => {
    const config = loadConfig({ [name]: value });
    expect(name === "CONCORD_TRUST_PROXY" ? config.trustProxyHops : config.maxAssetsPerOrg).toBe(expected);
  });

  it.each([
    ["CONCORD_TRUST_PROXY", "11", /CONCORD_TRUST_PROXY.*10/],
    ["CONCORD_MAX_ASSETS", "1001", /CONCORD_MAX_ASSETS.*1000/],
    ["CONCORD_PASSWORD_COST", "1048576:32:16", /128 MiB/],
    ["CONCORD_PASSWORD_COST", "262144:8:1", /128 MiB/],
  ])("rejects excessive %s before accepting config", (name, value, expected) => {
    expect(() => loadConfig({ [name]: value })).toThrow(expected);
  });

  it("preserves safe scrypt work factors and default settings", () => {
    expect(loadConfig({ CONCORD_PASSWORD_COST: "131072:8:1" }).passwordCost).toEqual({ N: 131072, r: 8, p: 1 });
    expect(loadConfig({ CONCORD_PASSWORD_COST: "32768:8:3" }).passwordCost).toEqual({ N: 32768, r: 8, p: 3 });
    expect(loadConfig({})).toMatchObject({ trustProxyHops: 0, maxAssetsPerOrg: 10 });
  });
});
