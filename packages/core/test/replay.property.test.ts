import { describe, it, expect } from "vitcolt";
import * as fc from "fast-check";
import { replay } from "../src/replay.js";
import type { Event, HoldingsState } from "../src/types.js";

const ACCOUNTS = ["alice", "bob", "carol", "dave", "eve"] as const;

type Account = (typeof ACCOUNTS)[number];

function sumBalances(state: HoldingsState): bigint {
  let total = 0n;
  for (const v of state.balances.values()) total += v;
  return total;
}

// Generate a valid event stream. Events are generated in id order and
// we track live balances so that transfers/burns/clawbacks only ever draw from
// available funds. This guarantees no balance goes negative and thus the
// replay never reports any incomplete events.
function genEventStream(): fc.Arbitrary<Event[]> {
  return fc.array(
    fc.natural({ max: 50 }),
    { maxLength: 40 },
  ).map((lengths) => {
    const live = new Map<string, bigint>();
    for (const a of ACCOUNTS) live.set(a, 0.);
    const events: Event[] = [];
    let id = 1;
    for (let i = 0; i < lengths.length; i++) {
      const kind = lengths[i] % 4;
      const amount = BigInt((lengths[i] % 97) + 1);
      if (kind === 0) {
        // mint
        const to = ACCOUNTS[lengths[i] % ACCOUNTS.length] as Account;
        live.set(to, (live.get(to) ?? 0n) + amount);
        events.push({ id, type: "mint", to, amount });
      } else if (kind === 1) {
        // transfer
        const from = ACCOUNTS[(lengths[i] + 1) % ACCOUNTS.length] as Account;
        const to = ACCOUNTS[(lengths[i] + 2) % ACCOUNTS.length] as Account;
        const available = live.get(from) ?? 0n;
        if (from !== to && available > 0n) {
          const move = available < amount ? available : amount;
          live.set(from, available - move);
          live.set(to, (live.get(to) ?? 0n) + move);
          events.push({ id, type: "transfer", from, to, amount: move });
        }
      } else if (kind === 2) {
        // burn
        const from = ACCOUNTS[lengths[i] % ACCOUNTS.length] as Account;
        const available = live.get(from) ?? 0n;
        if (available > 0n) {
          const burned = available < amount ? available : amount;
          live.set(from, available - burned);
          events.push({ id, type: "burn", from, amount: burned });
        }
      } else {
        // clawback
        const from = ACCOUNTS[(lengths[i] + 3) % ACCOUNTS.length] as Account;
        const available = live.get(from) ?? 0n;
        if (available > 0n) {
          const clawed = available < amount ? available : amount;
          live.set(from, available - clawed);
          events.push({ id, type: "clawback", from, amount: clawed });
        }
      }
      id++;
    }
    return events;
  });
}

function shuffle<T>(input: readonly T[], seed: number): T[] {
  const out = [...input];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("replay properties", () => {
  it("replay ignores the order events are supplied in", () => {
    fc.assert(
      fc.property(genEventStream(), fc.integer(), (events, seed) => {
        const baseline = replay(events);
        const shuffled = replay(shuffle(events, seed));

        expect(shuffled.supply).to.equal(baseline.supply);
        expect(shuffled.incomplete).to.haveLength(baseline.incomplete.length);
        expect(new Map(shuffled.balances)).to.equal(new Map(baseline.balances));
      }),
      { numRuns: 1000 },
    );
  });

  it("supply equals the sum of balances and no balance is negative", () => {
    fc.assert(
      fc.property(genEventStream(), (events) => {
        const state = replay(events);

        expect(state.incomplete).to.haveLength(0);
        expect(sumBalances(state)).to.equal(state.supply);
        for (const balance of state.balances.values()) {
          expect(balance >= 0n).to.be(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
