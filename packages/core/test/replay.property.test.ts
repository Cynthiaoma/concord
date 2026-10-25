import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { AssetEvent } from "../src/events.js";
import { replay } from "../src/holdings.js";

const ADDRESSES = ["GA", "GB", "GC", "GD"] as const;
const T0 = Date.parse("2026-10-01T00:00:00Z");
const RUNS = { numRuns: 1000 };

const stepArb = fc.record({
  kind: fc.constantFrom("mint", "transfer", "burn", "clawback"),
  from: fc.constantFrom(...ADDRESSES),
  to: fc.constantFrom(...ADDRESSES),
  amount: fc.bigInt({ min: 1n, max: 1000n }),
});

/**
 * Random event streams in which every debit is covered by the running balance, so no balance goes
 * negative and `incomplete` stays empty. A debit from a holder with nothing becomes a mint to them.
 * Ledgers are distinct, so event ids (and therefore replay order) are unique.
 */
const validStream: fc.Arbitrary<AssetEvent[]> = fc.array(stepArb, { maxLength: 40 }).map((steps) => {
  const held = new Map<string, bigint>();
  const events: AssetEvent[] = [];
  const push = (kind: AssetEvent["kind"], amount: bigint, fields: { from?: string; to?: string }): void => {
    const ledger = events.length + 1;
    events.push({
      id: `${String(ledger).padStart(10, "0")}-${String(ledger).padStart(10, "0")}`,
      assetId: "CASSET",
      kind,
      ledger,
      closedAt: new Date(T0 + ledger * 60_000).toISOString(),
      txHash: `tx${ledger}`,
      amount,
      ...fields,
    });
  };
  for (const step of steps) {
    const have = held.get(step.from) ?? 0n;
    if (step.kind === "mint" || have === 0n) {
      const to = step.kind === "mint" ? step.to : step.from;
      held.set(to, (held.get(to) ?? 0n) + step.amount);
      push("mint", step.amount, { to });
      continue;
    }
    const amount = step.amount < have ? step.amount : have;
    held.set(step.from, have - amount);
    if (step.kind === "transfer") {
      held.set(step.to, (held.get(step.to) ?? 0n) + amount);
      push("transfer", amount, { from: step.from, to: step.to });
    } else {
      push(step.kind, amount, { from: step.from });
    }
  }
  return events;
});

/** A stream and the same events in another order. */
const streamAndShuffle = validStream.chain((events) =>
  fc
    .shuffledSubarray(events, { minLength: events.length, maxLength: events.length })
    .map((shuffled) => ({ events, shuffled })),
);

describe("replay properties", () => {
  it("gives an identical state however the events are ordered", () => {
    fc.assert(
      fc.property(streamAndShuffle, ({ events, shuffled }) => {
        expect(replay(shuffled)).toEqual(replay(events));
      }),
      RUNS,
    );
  });

  it("keeps supply equal to the sum of the balances", () => {
    fc.assert(
      fc.property(validStream, (events) => {
        const state = replay(events);
        let sum = 0n;
        for (const amount of state.balances.values()) sum += amount;
        expect(state.supply).toBe(sum);
      }),
      RUNS,
    );
  });

  it("keeps supply equal to mints minus burns and clawbacks", () => {
    fc.assert(
      fc.property(validStream, (events) => {
        let expected = 0n;
        for (const e of events) {
          if (e.kind === "mint") expected += e.amount;
          else if (e.kind === "burn" || e.kind === "clawback") expected -= e.amount;
        }
        expect(replay(events).supply).toBe(expected);
      }),
      RUNS,
    );
  });

  it("never lets a balance go negative, and flags no incomplete history, for a valid stream", () => {
    fc.assert(
      fc.property(validStream, (events) => {
        const state = replay(events);
        for (const amount of state.balances.values()) expect(amount).toBeGreaterThanOrEqual(0n);
        expect(state.incomplete).toEqual([]);
        expect(state.skipped).toBeUndefined();
      }),
      RUNS,
    );
  });
});
