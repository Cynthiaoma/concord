import { parseUnits, DEFAULT_DECIMALS } from "./amount.js";
import { parseCsvTable } from "./csv.js";
import type { AssetEvent } from "./events.js";
import { sortEvents } from "./events.js";
import type { ParseIssue } from "./register.js";
import type { Severity } from "./reconcile.js";

export type ControlType = "authorize" | "freeze" | "unfreeze" | "clawback";

/** The off-chain approval that should stand behind every use of an issuer control. */
export interface Instruction {
  ref: string;
  type: ControlType;
  account: string;
  /** Clawback only. */
  units?: bigint;
  /** ISO-8601 time the instruction was approved. */
  issuedAt: string;
  approvedBy?: string;
  reason?: string;
}

export const INSTRUCTION_COLUMNS = ["ref", "type", "account", "units", "issued_at", "approved_by", "reason"] as const;

export function parseInstructionsCsv(
  text: string,
  decimals = DEFAULT_DECIMALS,
): { instructions: Instruction[]; issues: ParseIssue[] } {
  const table = parseCsvTable(text);
  for (const required of ["ref", "type", "account", "issued_at"]) {
    if (!table.headers.includes(required)) throw new Error(`instructions CSV needs a ${required} column`);
  }
  const instructions: Instruction[] = [];
  const issues: ParseIssue[] = [];
  for (const { line, values } of table.records) {
    try {
      const type = values.type!.toLowerCase().replace("authorise", "authorize");
      if (!["authorize", "freeze", "unfreeze", "clawback"].includes(type)) {
        throw new Error(`unknown type "${values.type}"`);
      }
      if (!values.ref) throw new Error("missing ref");
      if (!values.account) throw new Error("missing account");
      if (Number.isNaN(Date.parse(values.issued_at!))) throw new Error(`bad issued_at "${values.issued_at}"`);
      const instruction: Instruction = {
        ref: values.ref,
        type: type as ControlType,
        account: values.account,
        issuedAt: new Date(values.issued_at!).toISOString(),
      };
      if (type === "clawback") {
        if (!values.units) throw new Error("clawback needs units");
        const units = parseUnits(values.units, decimals);
        if (units <= 0n) throw new Error("clawback units must be greater than zero");
        instruction.units = units;
      }
      if (values.approved_by) instruction.approvedBy = values.approved_by;
      if (values.reason) instruction.reason = values.reason;
      instructions.push(instruction);
    } catch (err) {
      issues.push({ line, message: (err as Error).message });
    }
  }
  return { instructions, issues };
}

export interface ControlRecord {
  eventId: string;
  type: ControlType;
  account: string;
  units?: bigint;
  ledger: number;
  closedAt: string;
  txHash: string;
  /** Present when an instruction stands behind the action. */
  instruction?: Instruction;
}

export type ControlBreakType =
  | "UNINSTRUCTED_CONTROL"
  | "UNEXECUTED_INSTRUCTION"
  | "LATE_INSTRUCTION"
  | "INSTRUCTION_IN_FUTURE";

export interface ControlBreak {
  type: ControlBreakType;
  severity: Severity;
  key: string;
  address: string;
  ref?: string;
  eventId?: string;
  txHash?: string;
  message: string;
}

export interface ControlsLog {
  records: ControlRecord[];
  /** Instructions still inside their execution window. */
  pending: Instruction[];
  breaks: ControlBreak[];
  summary: { controls: number; instructed: number; uninstructed: number; unexecuted: number; pending: number };
}

export interface ControlsOptions {
  /** How long after approval an instruction may be executed. Default 72h. */
  windowMs?: number;
  /** ISO-8601 time the chain is indexed up to. Instructions past their window before it are breaks. */
  asOf: string;
  /** Accounts known to be frozen at baseline / start. */
  initialFrozen?: Iterable<string> | Map<string, { authorized?: boolean }>;
}

/**
 * Classify control events. The first set_authorized(true) for a holder is an authorisation;
 * one that follows a freeze is an unfreeze. Accounts present in `initialFrozen` start in the
 * frozen state.
 */
export function controlEvents(
  events: AssetEvent[],
  initialFrozen?: Iterable<string> | Map<string, { authorized?: boolean }>,
): ControlRecord[] {
  let frozen: Set<string>;
  if (!initialFrozen) {
    frozen = new Set<string>();
  } else if (initialFrozen instanceof Map) {
    frozen = new Set<string>();
    for (const [address, o] of initialFrozen) {
      if (o.authorized === false) frozen.add(address);
    }
  } else {
    frozen = new Set<string>(initialFrozen);
  }
  const out: ControlRecord[] = [];
  for (const ev of sortEvents(events)) {
    if (!ev.from) continue;
    const base = { eventId: ev.id, account: ev.from, ledger: ev.ledger, closedAt: ev.closedAt, txHash: ev.txHash };
    if (ev.kind === "clawback") {
      out.push({ ...base, type: "clawback", units: ev.amount });
    } else if (ev.kind === "set_authorized" && ev.authorized !== undefined) {
      if (ev.authorized) {
        out.push({ ...base, type: frozen.has(ev.from) ? "unfreeze" : "authorize" });
        frozen.delete(ev.from);
      } else {
        out.push({ ...base, type: "freeze" });
        frozen.add(ev.from);
      }
    }
  }
  return out;
}

function compatible(record: ControlRecord, instruction: Instruction): boolean {
  if (record.account !== instruction.account) return false;
  if (record.type === "clawback") {
    return instruction.type === "clawback" && instruction.units === record.units;
  }
  // History before the index start is unknown, so an unfreeze may look like an authorisation.
  const lifting = (t: ControlType) => t === "authorize" || t === "unfreeze";
  return record.type === instruction.type || (lifting(record.type) && lifting(instruction.type));
}

export function buildControlsLog(
  events: AssetEvent[],
  instructions: Instruction[],
  options: ControlsOptions,
): ControlsLog {
  const windowMs = options.windowMs ?? 72 * 3_600_000;
  const records = controlEvents(events, options.initialFrozen);
  const ordered = [...instructions].sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt));
  const used = new Set<string>();
  const breaks: ControlBreak[] = [];
  const asOf = Date.parse(options.asOf);

  const unmatched: ControlRecord[] = [];
  for (const record of records) {
    const t = Date.parse(record.closedAt);
    const hit = ordered.find((i) => {
      if (used.has(i.ref) || !compatible(record, i)) return false;
      const issued = Date.parse(i.issuedAt);
      return issued <= t && t - issued <= windowMs;
    });
    if (hit) {
      used.add(hit.ref);
      record.instruction = hit;
    } else {
      unmatched.push(record);
    }
  }

  // Late pairing runs only after every on-time match has been made, so an
  // instruction that properly covers a later event is never stolen by an
  // earlier one as "late". A compatible instruction written after the event is
  // one real-world action with a backdated paper trail — reporting it as
  // UNINSTRUCTED_CONTROL now and UNEXECUTED_INSTRUCTION when its window ends
  // described that single action as two unrelated breaks. The pairing is
  // bounded by the same execution window on the other side of the event: a
  // compatible instruction months later is not a backdated approval of this
  // event, and both findings stand on their own. An instruction dated after asOf cannot
  // be part of the log yet, so it is never paired here; it is reported as in the future below.
  for (const record of unmatched) {
    const t = Date.parse(record.closedAt);
    const late = ordered.find((i) => {
      if (used.has(i.ref) || !compatible(record, i)) return false;
      const issued = Date.parse(i.issuedAt);
      return issued > t && issued <= asOf && issued - t <= windowMs;
    });
    if (late) {
      used.add(late.ref);
      breaks.push({
        type: "LATE_INSTRUCTION",
        severity: "high",
        key: `LATE_INSTRUCTION:${record.eventId}`,
        address: record.account,
        ref: late.ref,
        eventId: record.eventId,
        txHash: record.txHash,
        message: `Instruction ${late.ref} (${late.type}) was issued after the on-chain ${record.type} it describes`,
      });
    } else {
      breaks.push({
        type: "UNINSTRUCTED_CONTROL",
        severity: "high",
        key: `UNINSTRUCTED_CONTROL:${record.eventId}`,
        address: record.account,
        eventId: record.eventId,
        txHash: record.txHash,
        message: `On-chain ${record.type} has no instruction behind it`,
      });
    }
  }

  const pending: Instruction[] = [];
  for (const instruction of ordered) {
    if (used.has(instruction.ref)) continue;
    const issued = Date.parse(instruction.issuedAt);
    if (issued > asOf) {
      breaks.push({
        type: "INSTRUCTION_IN_FUTURE",
        severity: "medium",
        key: `INSTRUCTION_IN_FUTURE:${instruction.ref}`,
        address: instruction.account,
        ref: instruction.ref,
        message: `Instruction ${instruction.ref} (${instruction.type}) is dated in the future (${instruction.issuedAt}) relative to asOf`,
      });
      continue;
    }
    if (issued + windowMs >= asOf) {
      pending.push(instruction);
      continue;
    }
    breaks.push({
      type: "UNEXECUTED_INSTRUCTION",
      severity: "medium",
      key: `UNEXECUTED_INSTRUCTION:${instruction.ref}`,
      address: instruction.account,
      ref: instruction.ref,
      message: `Instruction ${instruction.ref} (${instruction.type}) was never executed on-chain`,
    });
  }

  const instructed = records.filter((r) => r.instruction).length;
  return {
    records,
    pending,
    breaks,
    summary: {
      controls: records.length,
      instructed,
      uninstructed: records.length - instructed,
      unexecuted: breaks.filter((b) => b.type === "UNEXECUTED_INSTRUCTION").length,
      pending: pending.length,
    },
  };
}
