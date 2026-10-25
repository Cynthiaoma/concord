import { abs } from "./amount.js";
import type { HoldingsState } from "./holdings.js";
import type { HolderStatus, RegisterPosition } from "./register.js";

export type Severity = "high" | "medium" | "low";

export type PositionBreakType =
  | "QUANTITY_MISMATCH"
  | "MISSING_IN_REGISTER"
  | "MISSING_ON_CHAIN"
  | "UNMAPPED_HOLDER"
  | "STATUS_MISMATCH"
  | "SUPPLY_MISMATCH"
  | "INCOMPLETE_HISTORY";

export interface PositionBreak {
  type: PositionBreakType;
  severity: Severity;
  /** Stable across runs, so a break can be aged and its resolution carried forward. */
  key: string;
  address?: string;
  holderIds: string[];
  chainUnits?: bigint;
  registerUnits?: bigint;
  /** chain minus register. */
  difference?: bigint;
  /**
   * True when the break is a likely consequence of another finding rather
   * than an independent one — today, a supply mismatch while some holder's
   * history is incomplete. The primary break to act on is the one without
   * this flag.
   */
  consequential?: boolean;
  message: string;
}

export interface PositionLine {
  address: string;
  holderIds: string[];
  chainUnits: bigint;
  registerUnits: bigint;
  difference: bigint;
  chainStatus?: HolderStatus;
  registerStatus?: HolderStatus;
  matched: boolean;
}

export interface PositionReconciliation {
  lines: PositionLine[];
  breaks: PositionBreak[];
  summary: {
    chainSupply: bigint;
    registerTotal: bigint;
    /** Register units held by holders with no on-chain address. */
    unmappedUnits: bigint;
    chainHolders: number;
    registerHolders: number;
    matchedLines: number;
    breakCount: number;
    /** Sum of absolute per-address differences. */
    grossDifference: bigint;
  };
}

export interface ReconcileOptions {
  /** Absolute per-address difference that is still treated as agreement. */
  tolerance?: bigint;
  /** Addresses left out of both sides, e.g. an issuer treasury kept off the register. */
  ignore?: Iterable<string>;
}

export function reconcilePositions(
  chain: HoldingsState,
  register: RegisterPosition[],
  options: ReconcileOptions = {},
): PositionReconciliation {
  const tolerance = options.tolerance ?? 0n;
  const ignore = new Set(options.ignore ?? []);
  const breaks: PositionBreak[] = [];
  // Addresses whose indexed history is known to be incomplete. One missing
  // mint produces a negative derived balance AND a per-address quantity break
  // AND a supply mismatch — three findings with one root cause — so the
  // quantity break folds into the INCOMPLETE_HISTORY break below and the
  // supply mismatch is only flagged as consequential.
  const incomplete = new Set(chain.incomplete.filter((address) => !ignore.has(address)));

  const byAddress = new Map<string, { units: bigint; holderIds: string[]; statuses: Set<HolderStatus> }>();
  let registerTotal = 0n;
  let unmappedUnits = 0n;
  for (const p of register) {
    if (p.account && ignore.has(p.account)) continue;
    registerTotal += p.units;
    if (!p.account) {
      unmappedUnits += p.units;
      if (p.units > 0n) {
        breaks.push({
          type: "UNMAPPED_HOLDER",
          severity: "medium",
          key: `UNMAPPED_HOLDER:${p.holderId}`,
          holderIds: [p.holderId],
          registerUnits: p.units,
          message: `Register holder ${p.holderId} has units but no on-chain address`,
        });
      }
      continue;
    }
    const entry = byAddress.get(p.account) ?? { units: 0n, holderIds: [], statuses: new Set() };
    entry.units += p.units;
    if (!entry.holderIds.includes(p.holderId)) entry.holderIds.push(p.holderId);
    if (p.status) entry.statuses.add(p.status);
    byAddress.set(p.account, entry);
  }

  let chainSupply = 0n;
  let chainHolders = 0;
  for (const [address, amount] of chain.balances) {
    if (ignore.has(address)) continue;
    chainSupply += amount;
    // A negative derived balance is an artifact of missing history, not a
    // holder; counting it as one would overstate chainHolders in exactly the
    // runs where the history is already flagged.
    if (amount > 0n) chainHolders++;
  }

  const addresses = new Set<string>([...byAddress.keys()]);
  for (const address of chain.balances.keys()) if (!ignore.has(address)) addresses.add(address);

  const lines: PositionLine[] = [];
  let grossDifference = 0n;
  for (const address of [...addresses].sort()) {
    const reg = byAddress.get(address);
    const chainUnits = chain.balances.get(address) ?? 0n;
    const registerUnits = reg?.units ?? 0n;
    const holderIds = reg?.holderIds ?? [];
    const difference = chainUnits - registerUnits;
    const flag = chain.authorized.get(address);
    const chainStatus: HolderStatus | undefined = flag === undefined ? undefined : flag ? "active" : "frozen";
    const registerStatus: HolderStatus | undefined =
      reg && reg.statuses.size === 1 ? [...reg.statuses][0] : undefined;
    let matched = true;
    const base = { address, holderIds, chainUnits, registerUnits, difference };

    if (abs(difference) > tolerance) {
      matched = false;
      grossDifference += abs(difference);
      if (incomplete.has(address)) {
        // Folded: the quantity context rides on this address's
        // INCOMPLETE_HISTORY break below instead of standing as its own
        // MISSING_IN_REGISTER/QUANTITY_MISMATCH finding with the same cause.
      } else if (!reg) {
        breaks.push({
          ...base,
          type: "MISSING_IN_REGISTER",
          severity: "high",
          key: `MISSING_IN_REGISTER:${address}`,
          message: "On-chain holder is not on the register",
        });
      } else if (chainUnits === 0n) {
        breaks.push({
          ...base,
          type: "MISSING_ON_CHAIN",
          severity: "high",
          key: `MISSING_ON_CHAIN:${address}`,
          message: "Register holder has no on-chain balance",
        });
      } else {
        breaks.push({
          ...base,
          type: "QUANTITY_MISMATCH",
          severity: "high",
          key: `QUANTITY_MISMATCH:${address}`,
          message: "On-chain balance differs from the register",
        });
      }
    }
    if (chainStatus && registerStatus && chainStatus !== registerStatus) {
      matched = false;
      breaks.push({
        ...base,
        type: "STATUS_MISMATCH",
        severity: "medium",
        key: `STATUS_MISMATCH:${address}`,
        message: `Register shows ${registerStatus}, chain shows ${chainStatus}`,
      });
    }
    const line: PositionLine = { ...base, matched };
    if (chainStatus) line.chainStatus = chainStatus;
    if (registerStatus) line.registerStatus = registerStatus;
    lines.push(line);
  }

  if (abs(chainSupply - registerTotal) > tolerance) {
    breaks.push({
      type: "SUPPLY_MISMATCH",
      severity: "high",
      key: "SUPPLY_MISMATCH",
      holderIds: [],
      chainUnits: chainSupply,
      registerUnits: registerTotal,
      difference: chainSupply - registerTotal,
      ...(incomplete.size > 0 ? { consequential: true } : {}),
      message:
        incomplete.size > 0
          ? "Units outstanding on-chain differ from the register total; likely a consequence of the incomplete history flagged below"
          : "Units outstanding on-chain differ from the register total",
    });
  }
  for (const address of incomplete) {
    const chainUnits = chain.balances.get(address) ?? 0n;
    const registerUnits = byAddress.get(address)?.units ?? 0n;
    breaks.push({
      type: "INCOMPLETE_HISTORY",
      severity: "high",
      key: `INCOMPLETE_HISTORY:${address}`,
      address,
      holderIds: byAddress.get(address)?.holderIds ?? [],
      chainUnits,
      registerUnits,
      difference: chainUnits - registerUnits,
      message:
        "Indexed events do not cover this holder's full history; take a baseline. Its quantity differences are folded into this break",
    });
  }

  return {
    lines,
    breaks,
    summary: {
      chainSupply,
      registerTotal,
      unmappedUnits,
      chainHolders,
      registerHolders: register.filter((p) => p.units > 0n && (!p.account || !ignore.has(p.account))).length,
      matchedLines: lines.filter((l) => l.matched).length,
      breakCount: breaks.length,
      grossDifference,
    },
  };
}