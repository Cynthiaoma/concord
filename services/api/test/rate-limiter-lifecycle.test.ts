import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/security.js";

describe("rate-limiter lifecycle", () => {
  it("does not allocate a timer per instance", () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    try {
      for (let i = 0; i < 20; i++) new RateLimiter().dispose();
      expect(interval).not.toHaveBeenCalled();
    } finally {
      interval.mockRestore();
    }
  });

  it("sweeps expired entries on the next hit with an injected clock", () => {
    let time = 100_000;
    const limiter = new RateLimiter(() => time);
    expect(limiter.hit("old", 2, 2_000)).toBe(0);
    const windows = (limiter as unknown as { windows: Map<string, unknown> }).windows;
    expect(windows.has("old")).toBe(true);
    time += 60_001;
    expect(limiter.hit("new", 1, 60_000)).toBe(0);
    expect(windows.has("old")).toBe(false);
    expect(windows.has("new")).toBe(true);
    limiter.dispose();
    expect(windows.size).toBe(0);
  });
});
