import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Event model mirrors the replay input: mint / transfer / burn / clawback.
// `replay` is expected to be exported from the core package and to return a
// HoldingsState with `balances`, `supply`, and `incomplete` fields.
import { replay } from "../src/replay.js";

type Addr = "a" | "b" | "c" | "d";

type Event =
  | { id: number; kind: "mint"; to: Addr; amount: number }
  | { id: number; kind: "transfer"; from: Addr; to: Addr; amount: number }
  | { id: number; kind: "burn"; from: Addr; amount: number }
  | { id: number; kind: "clawback"; from: Addr; amount: number };

const ADDRS: Addr[] = ["a", "b", "c", "d"];

// Generates a sequence of events where every debit is covered by the running
// balance, so no balance ever goes negative and `incomplete` stays empty.
function validStream(maxLen: number): fc.Arbitrary<Event[]> {
  return fc
    .array(
      fc.record({
        kind: fc.constantFrom("mint", "transfer", "burn", "clawback"),
        from: fc.constantFrom(...ADDRS),
        to: fc.constantFrom(...ADDRS),
        amount: fc.integer({ min: 1, max: 1000 }),
        pick: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { maxLength: maxLength }
    )
    .map((raw) => {
      const balances = new Map<Addr, number>();
      const events: Event[] = [];
      let id = 1;
      for (const r of raw) {
        if (r.kind === "mint") {
          balances.set(r.to, (balances.get(r.to) ?? 0) + r.amount);
          events.push({ id: id++, kind: "mint", to: r.to, amount: r.amount });
          continue;
        }
        const have = balances.get(r.from) ?? 0;
        if (have === 0) {
          // No funds to debit: fall back to a mint so the stream stays valid.
          balances.set(r.from, (balances.get(r.from) ?? 0) + r.amount);
          events.push({ id: id++, kind: "mint", to: r.from, amount: r.amount });
          continue;
        }
        const amount = Math.min(r.amount, have);
        balances.set(r.from, have - amount);
        if (r.kind === "transfer") {
          balances.set(r.to, (balances.get(r.to) ?? 0) + amount);
          events.push({ id: id++, kind: "transfer", from: r.from, to: r.to, amount });
        } else {
          events.push({ id: id++, kind: r.kind, from: r.from, amount });
        }
      }
      return events;
    });
}

// Deterministic Fisher-Yates shuffle driven by fast-check's random source so
// failing cases are reproducible from the seed.
function shuffleArb<T>(items: T[]): fc.Arbitrary<T[]> {
  return fc
    .array(fc.double({ min: 0, max: 1, noNaN: true }), {
      minLength: items.length,
      maxLength: items.length,
    })
    .map((keys) => {
      const indexed = items.map((item, i) => ({ item, key: keys[i] }));
      indexed.sort((x, y) => x.key - y.key);
      return indexed.map((x) => x.item);
    });
}

const RUNS = { numRuns: 1000 };

describe("replay property tests", () => {
  it("shuffled input yields an identical HoldingsState", () => {
    fc.assert(
      fc.property(
        validStream(40).chain((events) =>
          shuffleArb(events).map((shuffled) => ({ events, shuffled }))
        ),
        ({ events, shuffled }) => {
          const original = replay(events);
          const reordered = replay(shuffled);
          expect(reordered).toEqual(original);
        }
      ),
      RUNS
    );
  });

  it("supply equals the sum of balances", () => {
    fc.assert(
      fc.property(validStream(40), (events) => {
        const state = replay(events);
        const sum = Object.values(state.balances as Record<string, number>).reduce(
          (acc, v) => acc + v,
          0
        );
        expect(state.supply).toBe(sum);
      }),
      RUNS
    );
  });

  it("supply equals mints minus burns and clawbacks", () => {
    fc.assert(
      fc.property(validStream(40), (events) => {
        const state = replay(events);
        let expected = 0;
        for (const e of events) {
          if (e.kind === "mint") expected += e.amount;
          else if (e.kind === "burn" || e.kind === "clawback") expected -= e.amount;
        }
        expect(state.supply).toBe(expected);
      }),
      RUNS
    );
  });

  it("no balance is negative and incomplete is empty for valid streams", () => {
    fc.assert(
      fc.property(validStream(40), (events) => {
        const state = replay(events);
        for (const v of Object.values(state.balances as Record<string, number>)) {
          expect(v).toBeGreaterThanOrEqual(0);
        }
        expect(state.incomplete).toEqual([]);
      }),
      RUNS
    );
  });
});
