import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

afterEach(() => vi.restoreAllMocks());

describe("optional .env loading", () => {
  it("ignores ENOENT only, preserving process environment defaults", () => {
    vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    expect(loadConfig(process.env).networks.mainnet.rpc.length).toBeGreaterThan(0);
  });

  it.each(["EACCES", "EISDIR", "ERR_INVALID_ARG_VALUE"])(
    "does not silently swallow %s while reading .env",
    (code) => {
      vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
        throw Object.assign(new Error(code), { code });
      });
      expect(() => loadConfig(process.env)).toThrow(`Failed to load .env: ${code}`);
    },
  );
});
