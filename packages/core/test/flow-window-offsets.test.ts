import { describe, expect, it } from "vitest";
import { observeFlows } from "../src/distributions.js";
import type { AssetEvent } from "../src/events.js";

const event = (id: number, closedAt: string): AssetEvent => ({
  id: `1-${id}`, assetId: "ASSET", kind: "mint", ledger: 1,
  closedAt, txHash: `tx-${id}`, to: "holder", amount: 10n,
});

describe("distribution flow windows", () => {
  it("compares UTC instants rather than lexically comparing offset times", () => {
    const events = [
      event(1, "2026-10-01T11:45:00Z"),
      event(2, "2026-10-01T12:15:00Z"),
      event(3, "2026-10-01T13:15:00Z"),
    ];
    const result = observeFlows(events, {
      afterTime: "2026-10-01T14:00:00+02:00",
      untilTime: "2026-10-01T15:00:00+02:00",
      plus: ["mint"], minus: [],
    });
    expect(result.get("holder")).toEqual({ amount: 10n, txHashes: ["tx-2"] });
  });

  it("rejects invalid date bounds", () => {
    expect(() => observeFlows([], { afterTime: "bad", plus: [], minus: [] })).toThrow("invalid afterTime");
    expect(() => observeFlows([], { untilTime: "bad", plus: [], minus: [] })).toThrow("invalid untilTime");
  });
});