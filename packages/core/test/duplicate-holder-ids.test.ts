import { describe, expect, it } from "vitest";
import { reconcilePositions } from "../src/reconcile.js";
import type { HoldingsState } from "../src/holdings.js";

describe("repeated register lots", () => {
  it("totals units while listing each holder only once", () => {
    const chain: HoldingsState = {
      balances: new Map([["ACCOUNT", 12n]]),
      authorized: new Map(), supply: 12n, ledger: 10,
      eventCount: 0, incomplete: [],
    };
    const result = reconcilePositions(chain, [
      { holderId: "H1", account: "ACCOUNT", units: 5n },
      { holderId: "H1", account: "ACCOUNT", units: 7n },
    ]);
    expect(result.lines[0]).toMatchObject({
      holderIds: ["H1"], registerUnits: 12n, matched: true,
    });
    expect(result.summary.breakCount).toBe(0);
  });
});