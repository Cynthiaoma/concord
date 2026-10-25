import { describe, expect, it } from "vitest";
import { reconcileMovements } from "../src/movements.js";
import type { AssetEvent } from "../src/events.js";

describe("journal transaction hash matching", () => {
  it("matches uppercase ledger hashes against lowercase journal hashes", () => {
    const event: AssetEvent = {
      id: "1-1", assetId: "ASSET", kind: "mint", ledger: 1,
      closedAt: "2026-10-01T12:00:00Z", txHash: "AABBCC",
      to: "holder", amount: 10n,
    };
    const result = reconcileMovements([event], [{
      ref: "J1", date: "2026-10-01", type: "issue",
      to: "holder", units: 10n, txHash: "aabbcc",
    }]);
    expect(result.summary).toMatchObject({ matched: 1, breakCount: 0 });
    expect(result.matches[0]).toMatchObject({ ref: "J1", by: "tx_hash" });
  });
});