import { describe, expect, it } from "vitest";
import {
  buildControlsLog,
  controlEvents,
  dividendEntitlements,
  formatUnits,
  mulDiv,
  observeFlows,
  parseCsv,
  parseCsvTable,
  parseInstructionsCsv,
  parseJournalCsv,
  parseRegisterCsv,
  parseRatio,
  parseUnits,
  reconcileDistribution,
  reconcileMovements,
  reconcilePositions,
  redemptionDeltas,
  replay,
  sortEvents,
  splitDeltas,
  templateCsv,
  TEMPLATES,
  toCsv,
  type Opening,
} from "../src/index.js";
import { ev, u } from "./fixtures.js";

describe("amounts", () => {
  it("round-trips decimals", () => {
    expect(parseUnits("1,234.5")).toBe(12_345_000_000n);
    expect(formatUnits(12_345_000_000n)).toBe("1234.5");
    expect(parseUnits("-0.0000001")).toBe(-1n);
    expect(formatUnits(-1n)).toBe("-0.0000001");
    expect(parseUnits("5.10000000")).toBe(51_000_000n);
  });
  it.each([
    ["0", 0n, 1n],
    ["0.5", 5n, 10n],
    ["10", 10n, 1n],
    ["0.0123456789", 123456789n, 10n ** 10n],
    [" 1 ", 1n, 1n],
  ])("parses non-negative ratio %j exactly", (raw, num, den) => {
    expect(parseRatio(raw)).toEqual({ num, den });
  });

  it.each(["-1", "1e-3", ".5", "1,5", ""])("rejects invalid ratio %j", (raw) => {
    expect(() => parseRatio(raw)).toThrow(`not a non-negative decimal: "${raw}"`);
  });

  it.each([
    ["1,234", 12_340_000_000n],
    ["12,345,678", 123_456_780_000_000n],
    ["-1,234.5", -12_345_000_000n],
  ])("accepts grouped amount %s", (raw, units) => {
    expect(parseUnits(raw)).toBe(units);
  });

  it.each(["1,23", "12,3456", "1,50,000", ",5", "1,,000"])(
    "rejects malformed grouping in %s",
    (raw) => {
      expect(() => parseUnits(raw)).toThrow(`not a decimal amount: "${raw}"`);
    },
  );

  it.each([
    [0n, 7, "0"],
    [1n, 7, "0.0000001"],
    [-1n, 7, "-0.0000001"],
    [10_000_000n, 7, "1"],
    [12_345_678n, 7, "1.2345678"],
    [5n, 0, "5"],
    [-5n, 0, "-5"],
    [1n, 18, "0.000000000000000001"],
  ])("formats %s units at %i decimals", (units, decimals, expected) => {
    const formatted = formatUnits(units, decimals);
    expect(formatted).toBe(expected);
    expect(formatted).not.toMatch(/\.$|\.\d*0$/);
  });

  it.each([" 12 ", "\t12\n"])("accepts surrounding whitespace in %j", (value) => {
    expect(parseUnits(value)).toBe(120_000_000n);
  });

  it.each(["1 000", "1\u00a0000", "- 5"])("rejects interior whitespace in %j", (value) => {
    expect(() => parseUnits(value)).toThrow(`not a decimal amount: "${value}"`);
  });

  it.each([
    [-1n, 1n, 1n, "mulDiv expects non-negative operands"],
    [1n, -1n, 1n, "mulDiv expects non-negative operands"],
    [1n, 1n, 0n, "denominator must be positive"],
    [1n, 1n, -1n, "denominator must be positive"],
    [-1n, 1n, 0n, "denominator must be positive"],
  ])("validates mulDiv operands (%s, %s, %s)", (a, b, den, error) => {
    expect(() => mulDiv(a, b, den)).toThrow(error);
  });

  it("refuses to round", () => {
    expect(() => parseUnits("0.00000001")).toThrow(/decimal places/);
    expect(() => parseUnits("1e5")).toThrow();
  });
});

describe("csv", () => {
  it("handles quotes, embedded commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, ""y""",2\r\n')).toEqual([
      ["a", "b"],
      ['x, "y"', "2"],
    ]);
    expect(toCsv(["a", "b"], [{ a: 'x, "y"', b: 2 }])).toBe('a,b\n"x, ""y""",2\n');
  });
});

describe("register decimal precision", () => {
  it("imports whole-token units exactly with zero decimal places", () => {
    const { positions, issues } = parseRegisterCsv("holder_id,account,units\nH0,A,1\n", 0);
    expect(issues).toEqual([]);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.units).toBe(1n);
  });

  it("reports fractional units as an issue for a zero-decimal token", () => {
    const { positions, issues } = parseRegisterCsv("holder_id,account,units\nH0,A,1.5\n", 0);
    expect(positions).toEqual([]);
    expect(issues).toEqual([{ line: 2, message: '"1.5" has more than 0 decimal places' }]);
  });

  it("retains every fractional digit for an 18-decimal token", () => {
    const { positions, issues } = parseRegisterCsv(
      "holder_id,account,units\nH18,A,1.123456789012345678\n", 18,
    );
    expect(issues).toEqual([]);
    expect(positions[0]!.units).toBe(1123456789012345678n);
  });

  it("keeps the default seven-decimal validation as a row issue", () => {
    const { positions, issues } = parseRegisterCsv("holder_id,account,units\nH7,A,1.12345678\n");
    expect(positions).toEqual([]);
    expect(issues).toEqual([{ line: 2, message: '"1.12345678" has more than 7 decimal places' }]);
  });
});

describe("transfer debit observations", () => {
  it("debits the sender for transfers listed in minus, without a payer", () => {
    const events = [ev("transfer", 8, { from: "A", to: "B", amount: u(7), txHash: "tx7" })];
    const observed = observeFlows(events, { plus: [], minus: ["transfer"] });
    expect([...observed.keys()]).toEqual(["A"]);
    expect(observed.get("A")).toEqual({ amount: -u(7), txHashes: ["tx7"] });
  });

  it("credits the payer transfer recipient and debits the sender when both configured", () => {
    const events = [ev("transfer", 9, { from: "PAY", to: "B", amount: u(2), txHash: "tx2" })];
    const observed = observeFlows(events, {
      plus: ["transfer"], minus: ["transfer"], payer: "PAY",
    });
    expect(observed.get("PAY")).toMatchObject({ amount: -u(2) });
    expect(observed.get("B")).toMatchObject({ amount: u(2) });
  });

  it("does not record a self-transfer as a debit or credit", () => {
    const events = [ev("transfer", 10, { from: "A", to: "A", amount: u(3) })];
    expect(observeFlows(events, { plus: ["transfer"], minus: ["transfer"], payer: "A" }).size).toBe(0);
  });
});

describe("transfer distribution payer validation", () => {
  it("rejects transfer observation without a payer rather than silently dropping events", () => {
    const events = [ev("transfer", 7, { from: "PAY", to: "H", amount: u(5) })];
    expect(() => observeFlows(events, { plus: ["transfer"], minus: [] }))
      .toThrow("transfer flows require a payer");
    expect(observeFlows(events, { plus: ["transfer"], minus: [], payer: "PAY" }).get("H")?.amount)
      .toBe(u(5));
  });

  it("allows payer-free mint observations", () => {
    const events = [ev("mint", 8, { to: "H", amount: u(3) })];
    expect(observeFlows(events, { plus: ["mint"], minus: [] }).get("H")?.amount).toBe(u(3));
  });
});

describe("CSV duplicate header validation", () => {
  it("reports duplicate normalized headers with both column positions", () => {
    expect(() => parseCsvTable("units,units\n1,2\n"))
      .toThrow('duplicate column "units" (columns 1 and 2)');
    expect(() => parseCsvTable("Units, units\n1,2\n"))
      .toThrow('duplicate column "units" (columns 1 and 2)');
    expect(() => parseCsvTable("holder-id,holder id\nH1,H2\n"))
      .toThrow('duplicate column "holder_id" (columns 1 and 2)');
  });

  it("allows multiple empty headers without creating an empty-key field", () => {
    const table = parseCsvTable("a,,\n1,unused,ignored\n");
    expect(table.records[0]!.values).toEqual({ a: "1" });
    expect(Object.keys(table.records[0]!.values)).toEqual(["a"]);
  });
});

describe("CSV prototype-safe headers", () => {
  it("preserves built-in object property names as regular CSV columns", () => {
    const table = parseCsvTable("__proto__,constructor,toString\nsafe,ctor,text\n");
    const values = table.records[0]!.values;
    expect(Object.getPrototypeOf(values)).toBeNull();
    expect(Object.keys(values)).toEqual(["__proto__", "constructor", "tostring"]);
    expect(values["__proto__"]).toBe("safe");
    expect(values.constructor).toBe("ctor");
    expect(values.tostring).toBe("text");
  });
});

describe("CSV closing quote validation", () => {
  it("rejects non-whitespace characters after a closing quote with location", () => {
    expect(() => parseCsv('"ab"cd,e')).toThrow("unexpected character after closing quote at line 1, column 5");
    expect(() => parseCsv('a,b\n"x"q,c')).toThrow("unexpected character after closing quote at line 2, column 4");
  });

  it("allows whitespace followed by a delimiter or line ending", () => {
    expect(parseCsv('"ab" ,c\n')).toEqual([["ab", "c"]]);
    expect(parseCsv('"ab"\n')).toEqual([["ab"]]);
    expect(parseCsv('"ab"\t,tail\r\n')).toEqual([["ab", "tail"]]);
  });
});

describe("CSV value safety", () => {
  it("serializes dates as stable UTC ISO strings and bigints exactly", () => {
    expect(toCsv(["value"], [{ value: new Date(0) }]))
      .toBe("value\n1970-01-01T00:00:00.000Z\n");
    expect(toCsv(["value"], [{ value: 10n }, { value: 1.5 }, { value: true }, { value: null }]))
      .toBe("value\n10\n1.5\ntrue\n\n");
  });

  it.each([NaN, Infinity, -Infinity])("rejects non-finite numbers (%s)", (value) => {
    expect(() => toCsv(["value"], [{ value }])).toThrow("cannot export non-finite number to CSV");
  });

  it.each([{}, { a: 1 }, [1, 2]])("rejects object and array values", (value) => {
    expect(() => toCsv(["value"], [{ value }])).toThrow("cannot export object or array to CSV");
  });

  it("rejects invalid dates rather than exporting Invalid Date", () => {
    expect(() => toCsv(["value"], [{ value: new Date(NaN) }]))
      .toThrow("cannot export invalid Date to CSV");
  });
});

describe("clawback instruction units", () => {
  it("reports non-positive clawback units and retains valid instructions", () => {
    const csv = [
      "ref,type,account,units,issued_at",
      "I0,clawback,GA,0,2026-10-01T00:00:00Z",
      "I1,clawback,GA,-1,2026-10-01T00:00:00Z",
      "I2,clawback,GA,2,2026-10-01T00:00:00Z",
    ].join("\n");
    const { instructions, issues } = parseInstructionsCsv(csv);
    expect(issues).toEqual([
      { line: 2, message: "clawback units must be greater than zero" },
      { line: 3, message: "clawback units must be greater than zero" },
    ]);
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toMatchObject({ ref: "I2", units: parseUnits("2") });
  });
});

describe("journal units validation", () => {
  it("rejects zero and negative units while retaining positive movement rows", () => {
    const csv = [
      "ref,date,type,from_account,to_account,units",
      "J0,2026-10-01,transfer,GA,GB,0",
      "J1,2026-10-01,transfer,GA,GB,-5",
      "J2,2026-10-01,transfer,GA,GB,1.5",
    ].join("\n");
    const { entries, issues } = parseJournalCsv(csv);
    expect(issues).toEqual([
      { line: 2, message: "units must be greater than zero" },
      { line: 3, message: "units must be greater than zero" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ref: "J2", units: parseUnits("1.5") });
  });
});

describe("CSV escaping matrix", () => {
  it.each([
    ["comma", "a,b", '"a,b"'],
    ["double quote", 'a"b', '"a""b"'],
    ["carriage return", "a\rb", '"a\rb"'],
    ["line feed", "a\nb", '"a\nb"'],
    ["CRLF", "a\r\nb", '"a\r\nb"'],
    ["leading spaces", " a", " a"],
    ["trailing spaces", "a ", "a "],
    ["empty string", "", ""],
    ["null", null, ""],
    ["undefined", undefined, ""],
  ])("escapes %s values", (_kind, value, escaped) => {
    expect(toCsv(["value"], [{ value }])).toBe(`value\n${escaped}\n`);
  });

  it("escapes CSV header cells by the same rules", () => {
    const headers = ["first,name", 'say"hi', "line\nbreak"];
    const row = { "first,name": "one", 'say"hi': "two", "line\nbreak": "three" };
    expect(toCsv(headers, [row])).toBe('"first,name","say""hi","line\nbreak"\none,two,three\n');
  });
});

describe("CSV trailing empty fields", () => {
  it("preserves trailing empty cells in nonblank rows", () => {
    expect(parseCsv("a,b,\n1,2,")).toEqual([
      ["a", "b", ""],
      ["1", "2", ""],
    ]);
  });

  it("drops rows consisting solely of empty fields", () => {
    expect(parseCsv(",\n")).toEqual([]);
    expect(parseCsv("a,b,\n,,\n1,2,")).toEqual([
      ["a", "b", ""],
      ["1", "2", ""],
    ]);
  });
});

describe("journal column aliases", () => {
  it("uses legacy from/to values when canonical account cells are blank", () => {
    const csv = [
      "ref,date,type,from,from_account,to,to_account,units",
      "J1,2026-10-01,transfer,GA,,GB,,2",
      "J2,2026-10-01,transfer,,GC,,GD,3",
    ].join("\n");
    const { entries, issues } = parseJournalCsv(csv);
    expect(issues).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ ref: "J1", from: "GA", to: "GB", units: parseUnits("2") });
    expect(entries[1]).toMatchObject({ ref: "J2", from: "GC", to: "GD", units: parseUnits("3") });
  });

  it.each([
    ["from,to", "GA,GB"],
    ["from_account,to_account", "GA,GB"],
  ])("keeps single naming scheme %s working", (headers, accounts) => {
    const { entries, issues } = parseJournalCsv(
      `ref,date,type,${headers},units\nJ3,2026-10-01,transfer,${accounts},1\n`,
    );
    expect(issues).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ from: "GA", to: "GB", units: parseUnits("1") });
  });
});

describe("templates", () => {
  it.each(Object.entries(TEMPLATES))("keeps the %s template header-only by default", (kind, columns) => {
    const header = `${columns.join(",")}\n`;
    expect(templateCsv(kind)).toBe(header);
    expect(templateCsv(kind, { example: false })).toBe(header);
  });

  it("parses exactly one illustrative row for every template kind", () => {
    for (const kind of Object.keys(TEMPLATES)) {
      const csv = templateCsv(kind, { example: true })!;
      expect(parseCsv(csv)).toHaveLength(2);
      if (kind === "register") {
        const { positions, issues } = parseRegisterCsv(csv);
        expect(issues).toEqual([]);
        expect(positions).toHaveLength(1);
        expect(positions[0]).toMatchObject({ units: parseUnits("100.5"), status: "active" });
      } else if (kind === "journal") {
        const { entries, issues } = parseJournalCsv(csv);
        expect(issues).toEqual([]);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ units: parseUnits("10.5"), type: "transfer", date: "2026-10-01" });
      } else {
        const { instructions, issues } = parseInstructionsCsv(csv);
        expect(issues).toEqual([]);
        expect(instructions).toHaveLength(1);
        expect(instructions[0]).toMatchObject({
          units: parseUnits("5.5"), type: "clawback", issuedAt: "2026-10-01T12:00:00.000Z",
        });
      }
    }
  });

  it.each(["unknown", "toString", "__proto__"])("returns undefined for unknown kind %s", (kind) => {
    expect(templateCsv(kind)).toBeUndefined();
    expect(templateCsv(kind, { example: true })).toBeUndefined();
  });
});

describe("replay", () => {
  const history = [
    ev("set_authorized", 1, { from: "A", authorized: true }),
    ev("mint", 2, { to: "A", amount: u(100) }),
    ev("mint", 3, { to: "B", amount: u(50) }),
    ev("transfer", 4, { from: "A", to: "B", amount: u(10) }),
    ev("burn", 5, { from: "B", amount: u(5) }),
    ev("clawback", 6, { from: "A", amount: u(20) }),
    ev("set_authorized", 7, { from: "A", authorized: false }),
  ];

  it("derives balances, supply and authorisation", () => {
    const s = replay(history);
    expect(s.balances.get("A")).toBe(u(70));
    expect(s.balances.get("B")).toBe(u(55));
    expect(s.supply).toBe(u(125));
    expect(s.authorized.get("A")).toBe(false);
    expect(s.ledger).toBe(7);
  });

  it("stops at a record ledger or time", () => {
    expect(replay(history, { upToLedger: 3 }).supply).toBe(u(150));
    expect(replay(history, { upToTime: "2026-10-01T00:04:00.000Z" }).balances.get("B")).toBe(u(60));
  });

  it("skips events a baseline already reflects, per holder", () => {
    const opening = new Map<string, Opening>([
      ["A", { amount: u(90), authorized: true, asOfLedger: 4 }],
      ["B", { amount: u(50), asOfLedger: 3 }],
    ]);
    const s = replay(history, { opening, baselineLedger: 3 });
    expect(s.balances.get("A")).toBe(u(70));
    expect(s.balances.get("B")).toBe(u(55));
  });

  it("flags holders whose history is incomplete", () => {
    const s = replay([ev("transfer", 9, { from: "X", to: "Y", amount: u(1) })]);
    expect(s.incomplete).toEqual(["X"]);
  });

  it("orders unpadded ids by number, not as strings", () => {
    const later = { ...ev("transfer", 10, { from: "A", to: "B", amount: u(1) }), id: "10-1" };
    const earlier = { ...ev("mint", 9, { to: "A", amount: u(5) }), id: "9-1" };
    expect(sortEvents([later, earlier]).map((e) => e.id)).toEqual(["9-1", "10-1"]);
    expect(replay([later, earlier], { upToLedger: 9 }).balances.get("A")).toBe(u(5));
    const rpc = ["0000000429496729600-0000000002", "0000000429496729600-0000000001"];
    expect(sortEvents(rpc.map((id) => ({ id }))).map((e) => e.id)).toEqual([rpc[1], rpc[0]]);
  });

  it("rejects ids that are not in the RPC form", () => {
    expect(() => sortEvents([{ id: "9-1" }, { id: "abc" }])).toThrow(/event id "abc"/);
    expect(() => replay([{ ...ev("mint", 1, { to: "A", amount: u(1) }), id: "1" }])).toThrow(/RPC form/);
  });

  it("reports skipped malformed events missing required addresses", () => {
    const malformedMint = ev("mint", 1, { amount: u(10) }); // missing 'to'
    const malformedBurn = ev("burn", 2, { amount: u(5) }); // missing 'from'
    const malformedTransfer = ev("transfer", 3, { from: "A", amount: u(1) }); // missing 'to'
    const validMint = ev("mint", 4, { to: "A", amount: u(50) });

    const s = replay([malformedMint, malformedBurn, malformedTransfer, validMint]);
    expect(s.supply).toBe(u(50));
    expect(s.balances.get("A")).toBe(u(50));
    expect(s.eventCount).toBe(1);
    expect(s.skipped).toHaveLength(3);
    expect(s.skipped?.map((e) => e.kind)).toEqual(["mint", "burn", "transfer"]);
  });
});

describe("position reconciliation", () => {
  const chain = replay([
    ev("mint", 1, { to: "A", amount: u(100) }),
    ev("mint", 1, { to: "B", amount: u(40) }),
    ev("mint", 1, { to: "C", amount: u(7) }),
    ev("set_authorized", 2, { from: "B", authorized: false }),
  ]);

  it("agrees when the books agree, including omnibus accounts", () => {
    const { positions } = parseRegisterCsv(
      "holder_id,account,units,status\nH1,A,60,\nH2,A,40,\nH3,B,40,frozen\nH4,C,7,\n",
    );
    const r = reconcilePositions(chain, positions);
    expect(r.breaks).toEqual([]);
    expect(r.summary.matchedLines).toBe(3);
    expect(r.lines[0]!.holderIds).toEqual(["H1", "H2"]);
  });

  it("excludes ignored treasury accounts from registerHolders and chainHolders (#33)", () => {
    const holdings = replay([
      ev("mint", 1, { to: "H", amount: u(100) }),
      ev("mint", 2, { to: "TRE", amount: u(5) }),
    ]);
    const { positions, issues } = parseRegisterCsv(
      "holder_id,account,units\nH1,H,100\nT1,TRE,5\n",
    );
    expect(issues).toEqual([]);

    const result = reconcilePositions(holdings, positions, { ignore: ["TRE"] });
    expect(result.summary.registerHolders).toBe(1);
    expect(result.summary.chainHolders).toBe(1);
    expect(result.summary.registerTotal).toBe(u(100));
    expect(result.breaks).toEqual([]);

    const unfiltered = reconcilePositions(holdings, positions);
    expect(unfiltered.summary.registerHolders).toBe(2);
    expect(unfiltered.summary.chainHolders).toBe(2);
  });

  it("flags every kind of break", () => {
    const { positions, issues } = parseRegisterCsv(
      "Holder ID,Name,Address,Shares,Status\nH1,Ann,A,90,active\nH3,Bo,B,40,active\nH5,Di,D,3,\nH6,Ed,,2,\nH7,Bad,E,x,\n",
    );
    expect(issues).toHaveLength(1);
    const r = reconcilePositions(chain, positions);
    expect(r.breaks.map((b) => b.type).sort()).toEqual([
      "MISSING_IN_REGISTER",
      "MISSING_ON_CHAIN",
      "QUANTITY_MISMATCH",
      "STATUS_MISMATCH",
      "SUPPLY_MISMATCH",
      "UNMAPPED_HOLDER",
    ]);
    const qty = r.breaks.find((b) => b.type === "QUANTITY_MISMATCH")!;
    expect(qty.difference).toBe(u(10));
    expect(r.summary.grossDifference).toBe(u(20));
  });

  it("honours tolerance and ignored addresses", () => {
    const { positions } = parseRegisterCsv("holder_id,account,units\nH1,A,100.0000001\nH3,B,40\n");
    const r = reconcilePositions(chain, positions, { tolerance: 1n, ignore: ["C"] });
    expect(r.breaks).toEqual([]);
  });

  it("folds an incomplete holder's quantity breaks into INCOMPLETE_HISTORY", () => {
    // A transfer with no earlier mint: X derives to -30, A to 30. One root
    // cause — missing history — must not read as three independent breaks.
    const partial = replay([ev("transfer", 5, { from: "X", to: "A", amount: u(30) })]);
    expect(partial.incomplete).toEqual(["X"]);

    const { positions } = parseRegisterCsv("holder_id,account,units\nH1,A,30\n");
    const r = reconcilePositions(partial, positions);

    // INCOMPLETE_HISTORY is the primary break, carrying X's quantity context.
    const primary = r.breaks.filter((b) => !b.consequential);
    expect(primary.map((b) => b.type)).toEqual(["INCOMPLETE_HISTORY"]);
    expect(primary[0]).toMatchObject({
      address: "X",
      chainUnits: u(-30),
      registerUnits: 0n,
      difference: u(-30),
    });

    // No separate MISSING_IN_REGISTER for X; the supply mismatch remains but
    // is flagged as a consequence of the missing history.
    expect(r.breaks.some((b) => b.type === "MISSING_IN_REGISTER")).toBe(false);
    const supply = r.breaks.find((b) => b.type === "SUPPLY_MISMATCH")!;
    expect(supply.consequential).toBe(true);
    expect(supply.message).toContain("incomplete history");

    // A negative derived balance is an artifact, not a holder.
    expect(r.summary.chainHolders).toBe(1);
    expect(r.summary.chainSupply).toBe(0n);
    // The line itself still shows the discrepancy for anyone drilling in.
    const lineX = r.lines.find((l) => l.address === "X")!;
    expect(lineX.matched).toBe(false);
  });

  it("keeps supply mismatches independent when every history is complete", () => {
    const { positions } = parseRegisterCsv("holder_id,account,units\nH1,A,90\nH3,B,40\nH4,C,7\n");
    const r = reconcilePositions(chain, positions);
    const supply = r.breaks.find((b) => b.type === "SUPPLY_MISMATCH")!;
    expect(supply.consequential).toBeUndefined();
    expect(supply.message).not.toContain("incomplete");
  });
});

describe("movement reconciliation", () => {
  const events = [
    ev("mint", 10, { to: "A", amount: u(100), txHash: "aa" }),
    ev("transfer", 20, { from: "A", to: "B", amount: u(10), txHash: "bb" }),
    ev("transfer", 30, { from: "A", to: "B", amount: u(10), txHash: "cc" }),
    ev("clawback", 40, { from: "B", amount: u(5), txHash: "dd" }),
    ev("burn", 50, { from: "A", amount: u(1), txHash: "ee" }),
  ];

  it("matches by hash, then by attributes, and reports the rest", () => {
    const { entries, issues } = parseJournalCsv(
      [
        "ref,date,type,from_account,to_account,units,tx_hash",
        "J1,2026-10-01,issue,,A,99,AA",
        "J2,2026-10-01,transfer,A,B,10,",
        "J3,2026-10-01,redemption,B,,5,",
        "J4,2026-10-01,transfer,B,A,3,",
        "J5,2026-09-20,transfer,A,B,10,",
      ].join("\n"),
    );
    expect(issues).toEqual([]);
    const r = reconcileMovements(events, entries);
    expect(r.matches).toHaveLength(3);
    expect(r.breaks.map((b) => `${b.type}:${b.ref ?? b.txHash}`).sort()).toEqual([
      "MOVEMENT_AMOUNT_MISMATCH:J1",
      "UNRECORDED_MOVEMENT:cc",
      "UNRECORDED_MOVEMENT:ee",
      "UNSETTLED_ENTRY:J4",
      "UNSETTLED_ENTRY:J5",
    ]);
  });

  it("limits reporting to the period", () => {
    const r = reconcileMovements(events, [], { from: "2026-10-01T00:25:00Z", to: "2026-10-01T00:45:00Z" });
    expect(r.breaks.map((b) => b.txHash)).toEqual(["cc", "dd"]);
  });

  it("does not pair an entry citing tx_hash aa with an event from tx bb by attributes", () => {
    const evs = [
      ev("transfer", 20, { from: "A", to: "B", amount: u(10), txHash: "bb" }),
    ];
    const { entries } = parseJournalCsv(
      "ref,date,type,from_account,to_account,units,tx_hash\nJ1,2026-10-01,transfer,A,B,10,aa\n",
    );
    const r = reconcileMovements(evs, entries);
    expect(r.matches).toHaveLength(0);
    expect(r.breaks.map((b) => b.type).sort()).toEqual([
      "UNRECORDED_MOVEMENT",
      "UNSETTLED_ENTRY",
    ]);
    const unsettled = r.breaks.find((b) => b.type === "UNSETTLED_ENTRY")!;
    expect(unsettled.ref).toBe("J1");
    expect(unsettled.txHash).toBe("aa");
  });
});

describe("corporate actions", () => {
  const history = [
    ev("mint", 1, { to: "A", amount: u(100) }),
    ev("mint", 1, { to: "B", amount: u(50) }),
    ev("mint", 1, { to: "C", amount: 3n }),
    ev("mint", 1, { to: "TREASURY", amount: u(1000) }),
    ev("transfer", 9, { from: "A", to: "D", amount: u(100) }),
  ];
  const snapshot = replay(history, { upToLedger: 5 });

  it("snapshots holdings at the record ledger", () => {
    expect(snapshot.balances.get("A")).toBe(u(100));
    expect(snapshot.balances.has("D")).toBe(false);
  });

  it("reconciles a cash dividend", () => {
    const expected = dividendEntitlements(snapshot, {
      ratePerUnit: "0.0123456789",
      baseDecimals: 7,
      payDecimals: 7,
      exclude: ["TREASURY"],
    });
    expect(expected.get("A")).toBe(12_345_678n);
    expect(expected.get("B")).toBe(6_172_839n);
    expect(expected.has("C")).toBe(false);
    const cash = [
      ev("transfer", 10, { from: "PAYER", to: "A", amount: 12_345_678n }),
      ev("transfer", 10, { from: "PAYER", to: "B", amount: 6_000_000n }),
      ev("transfer", 10, { from: "PAYER", to: "D", amount: 5n }),
      ev("transfer", 10, { from: "SOMEONE", to: "A", amount: 999n }),
    ];
    const observed = observeFlows(cash, { fromLedger: 6, plus: ["transfer"], minus: [], payer: "PAYER" });
    const r = reconcileDistribution(snapshot, expected, observed);
    expect(r.breaks.map((b) => `${b.type}:${b.address}`)).toEqual(["SHORT:B", "UNEXPECTED:D"]);
    expect(r.lines.find((l) => l.address === "A")!.status).toBe("ok");
    expect(r.summary.difference).toBe(-172_834n);
  });

  it("validates baseDecimals and payDecimals as integers from 0 to 38", () => {
    expect(() =>
      dividendEntitlements(snapshot, {
        ratePerUnit: "1",
        baseDecimals: -1,
        payDecimals: 7,
      }),
    ).toThrow("baseDecimals must be an integer from 0 to 38, got -1");

    expect(() =>
      dividendEntitlements(snapshot, {
        ratePerUnit: "1",
        baseDecimals: 7,
        payDecimals: 1.5,
      }),
    ).toThrow("payDecimals must be an integer from 0 to 38, got 1.5");
  });

  it("does not count a payer's transfer to itself as a distribution", () => {
    const cash = [
      ev("transfer", 10, { from: "PAYER", to: "PAYER", amount: u(9) }),
      ev("transfer", 10, { from: "PAYER", to: "A", amount: u(1) }),
    ];
    const observed = observeFlows(cash, { fromLedger: 6, plus: ["transfer"], minus: [], payer: "PAYER" });
    expect(observed.has("PAYER")).toBe(false);
    expect(observed.get("A")!.amount).toBe(u(1));
  });

  it("reports an unpaid holder", () => {
    const expected = dividendEntitlements(snapshot, { ratePerUnit: "1", baseDecimals: 7, payDecimals: 2 });
    expect(expected.get("B")).toBe(5000n);
    const r = reconcileDistribution(snapshot, expected, new Map(), { ignore: ["TREASURY", "A"] });
    expect(r.breaks.map((b) => b.type)).toEqual(["MISSING"]);
  });

  it("reconciles a forward split", () => {
    const expected = splitDeltas(snapshot, { num: 3n, den: 2n }, ["TREASURY"]);
    expect(expected.get("A")).toBe(u(50));
    expect(expected.get("C")).toBe(1n);
    const mints = [
      ev("mint", 12, { to: "A", amount: u(50) }),
      ev("mint", 12, { to: "B", amount: u(30) }),
      ev("mint", 2, { to: "A", amount: u(7) }),
    ];
    const observed = observeFlows(mints, { fromLedger: 11, plus: ["mint"], minus: ["clawback"] });
    const r = reconcileDistribution(snapshot, expected, observed);
    expect(r.breaks.map((b) => `${b.type}:${b.address}`)).toEqual(["EXCESS:B", "MISSING:C"]);
  });

  it("reconciles a reverse split and a redemption", () => {
    const reverse = splitDeltas(snapshot, { num: 1n, den: 10n }, ["TREASURY", "C"]);
    expect(reverse.get("A")).toBe(-u(90));
    const full = redemptionDeltas(snapshot, { num: 1n, den: 1n }, ["TREASURY", "C"]);
    const flows = [ev("clawback", 20, { from: "A", amount: u(100) }), ev("burn", 21, { from: "B", amount: u(20) })];
    const observed = observeFlows(flows, { fromLedger: 15, plus: [], minus: ["burn", "clawback"] });
    const r = reconcileDistribution(snapshot, full, observed);
    expect(r.breaks.map((b) => `${b.type}:${b.address}`)).toEqual(["SHORT:B"]);
  });

  it("does not count zero/zero netted-out flows in summary.holders while keeping txHashes", () => {
    const flows = [
      ev("mint", 10, { to: "A", amount: 5n, txHash: "tx_mint" }),
      ev("clawback", 11, { from: "A", amount: 5n, txHash: "tx_clawback" }),
    ];
    const observed = observeFlows(flows, { fromLedger: 1, plus: ["mint"], minus: ["clawback"] });
    expect(observed.get("A")?.amount).toBe(0n);
    expect(observed.get("A")?.txHashes).toEqual(["tx_mint", "tx_clawback"]);

    const r = reconcileDistribution(snapshot, new Map(), observed);
    expect(r.summary.holders).toBe(0);
    expect(r.lines.length).toBe(1);
    const lineA = r.lines.find((l) => l.address === "A");
    expect(lineA).toBeDefined();
    expect(lineA!.expected).toBe(0n);
    expect(lineA!.observed).toBe(0n);
    expect(lineA!.difference).toBe(0n);
    expect(lineA!.status).toBe("ok");
    expect(lineA!.txHashes).toEqual(["tx_mint", "tx_clawback"]);
  });

  it("rates opposite-sign flow as high severity UNEXPECTED", () => {
    const expected = new Map([["A", u(100)]]);
    const observed = new Map([["A", { amount: -u(100), txHashes: ["tx1"] }]]);
    const r = reconcileDistribution(snapshot, expected, observed);
    expect(r.breaks).toHaveLength(1);
    const b = r.breaks[0]!;
    expect(b.type).toBe("UNEXPECTED");
    expect(b.severity).toBe("high");
    expect(b.address).toBe("A");
  });
});

describe("controls log", () => {
  const events = [
    ev("set_authorized", 1, { from: "A", authorized: true }),
    ev("set_authorized", 100, { from: "A", authorized: false }),
    ev("set_authorized", 200, { from: "A", authorized: true }),
    ev("clawback", 300, { from: "B", amount: u(5) }),
    ev("clawback", 400, { from: "B", amount: u(6) }),
    ev("mint", 2, { to: "A", amount: u(1) }),
  ];

  it("does not treat set_authorized without a flag as a freeze (#42)", () => {
    const missingFlag = ev("set_authorized", 9, { from: "A" });
    expect(controlEvents([missingFlag])).toEqual([]);
    expect(replay([missingFlag]).authorized.has("A")).toBe(false);

    const validFreeze = ev("set_authorized", 10, { from: "A", authorized: false });
    const validUnfreeze = ev("set_authorized", 11, { from: "A", authorized: true });
    expect(controlEvents([missingFlag, validFreeze, validUnfreeze]).map((record) => record.type))
      .toEqual(["freeze", "unfreeze"]);
  });

  it("ties each control to its instruction and flags the rest", () => {
    const { instructions, issues } = parseInstructionsCsv(
      [
        "ref,type,account,units,issued_at,approved_by,reason",
        "I1,authorise,A,,2026-10-01T00:00:00Z,ops,KYC passed",
        "I2,freeze,A,,2026-10-01T01:00:00Z,compliance,court order",
        "I3,clawback,B,5,2026-10-01T04:00:00Z,compliance,error correction",
        "I4,freeze,C,,2026-10-01T00:00:00Z,compliance,sanctions",
        "I5,freeze,D,,2026-10-06T00:00:00Z,compliance,review",
      ].join("\n"),
    );
    expect(issues).toEqual([]);
    const log = buildControlsLog(events, instructions, { asOf: "2026-10-06T12:00:00Z" });
    expect(log.records.map((r) => r.type)).toEqual(["authorize", "freeze", "unfreeze", "clawback", "clawback"]);
    expect(log.records.map((r) => r.instruction?.ref)).toEqual(["I1", "I2", undefined, "I3", undefined]);
    expect(log.breaks.map((b) => b.type)).toEqual([
      "UNINSTRUCTED_CONTROL",
      "UNINSTRUCTED_CONTROL",
      "UNEXECUTED_INSTRUCTION",
    ]);
    expect(log.pending.map((i) => i.ref)).toEqual(["I5"]);
  });

  it("does not accept an instruction issued after the action", () => {
    const { instructions } = parseInstructionsCsv(
      "ref,type,account,issued_at\nI9,freeze,A,2026-10-02T00:00:00Z\n",
    );
    const log = buildControlsLog(events.slice(1, 2), instructions, { asOf: "2026-10-02T01:00:00Z" });
    expect(log.summary.uninstructed).toBe(1);
  });

  it("folds a backdated approval into one LATE_INSTRUCTION break", () => {
    // The freeze closes at ledger 100 (01:40); the instruction is written one
    // minute later. One real-world action with a backdated paper trail used to
    // surface as UNINSTRUCTED_CONTROL plus, once the window lapsed,
    // UNEXECUTED_INSTRUCTION — two breaks for one thing.
    const { instructions } = parseInstructionsCsv(
      "ref,type,account,issued_at\nI8,freeze,A,2026-10-01T01:41:00Z\n",
    );
    const log = buildControlsLog(events.slice(1, 2), instructions, { asOf: "2026-10-06T12:00:00Z" });
    expect(log.breaks).toHaveLength(1);
    const b = log.breaks[0]!;
    expect(b.type).toBe("LATE_INSTRUCTION");
    expect(b.ref).toBe("I8");
    expect(b.address).toBe("A");
    expect(b.eventId).toBe(log.records[0]!.eventId);
    // Consumed: not pending, not unexecuted — but the record is still not
    // "instructed", because nothing stood behind the action when it happened.
    expect(log.pending).toEqual([]);
    expect(log.summary.unexecuted).toBe(0);
    expect(log.records[0]!.instruction).toBeUndefined();
  });

  it("leaves an instruction issued beyond the window after the event as two breaks", () => {
    // Four days after the freeze is not a backdated approval of it; both
    // findings stand on their own.
    const { instructions } = parseInstructionsCsv(
      "ref,type,account,issued_at\nI9,freeze,A,2026-10-05T00:00:00Z\n",
    );
    const log = buildControlsLog(events.slice(1, 2), instructions, { asOf: "2026-10-10T00:00:00Z" });
    expect(log.breaks.map((b) => b.type).sort()).toEqual([
      "UNEXECUTED_INSTRUCTION",
      "UNINSTRUCTED_CONTROL",
    ]);
  });

  it("never lets an earlier event steal a later event's on-time instruction as late", () => {
    const freezes = [
      ev("set_authorized", 100, { from: "A", authorized: false }),
      ev("set_authorized", 300, { from: "A", authorized: false }),
    ];
    // Issued 02:00 — after the first freeze (01:40), before the second (05:00):
    // an on-time instruction for the second, which must win over a late
    // pairing with the first.
    const { instructions } = parseInstructionsCsv(
      "ref,type,account,issued_at\nI10,freeze,A,2026-10-01T02:00:00Z\n",
    );
    const log = buildControlsLog(freezes, instructions, { asOf: "2026-10-06T12:00:00Z" });
    expect(log.records[1]!.instruction?.ref).toBe("I10");
    expect(log.breaks.map((b) => b.type)).toEqual(["UNINSTRUCTED_CONTROL"]);
    expect(log.breaks[0]!.eventId).toBe(log.records[0]!.eventId);
  });

  it("gives identical output for the same input on repeated calls", () => {
    const { instructions } = parseInstructionsCsv(
      "ref,type,account,issued_at\nI1,freeze,A,2026-10-01T00:00:00Z\n",
    );
    const options = { asOf: "2026-10-06T12:00:00Z" };
    expect(buildControlsLog(events, instructions, options)).toEqual(
      buildControlsLog(events, instructions, options),
    );
  });

  // #52 — core is documented as reading no clock. The offending
  // `options.asOf ? … : Date.now()` is already gone and `asOf` is required,
  // but nothing stopped a clock read from creeping back in. This pins the
  // invariant across ALL of packages/core/src, not one function's behaviour.
  it("reads no clock anywhere in packages/core/src (#52)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const srcDir = join(__dirname, "..", "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|js|mts|mjs)$/.test(entry)) files.push(full);
      }
    };
    walk(srcDir);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      // `Date.now()` and a no-argument `new Date()` both read the wall clock;
      // `new Date(value)` parses its input and stays pure.
      return /\bDate\.now\s*\(/.test(source) || /\bnew Date\s*\(\s*\)/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("logs unfreeze when an initially frozen account is lifted", () => {
    const liftEvents = [ev("set_authorized", 50, { from: "FROZEN_HOLDER", authorized: true })];

    // No opening data keeps current behaviour (first lift logged as authorize)
    const defaultRecords = controlEvents(liftEvents);
    expect(defaultRecords[0].type).toBe("authorize");

    // With initial frozen set (from openings), opening frozen then lifted logs unfreeze
    const unfreezeRecords = controlEvents(liftEvents, new Set(["FROZEN_HOLDER"]));
    expect(unfreezeRecords[0].type).toBe("unfreeze");

    // Also supports Map from openings (where authorized === false)
    const openings = new Map<string, Opening>([
      ["FROZEN_HOLDER", { amount: 100n, authorized: false, asOfLedger: 1 }],
      ["ACTIVE_HOLDER", { amount: 200n, authorized: true, asOfLedger: 1 }],
    ]);
    const fromOpenings = controlEvents(liftEvents, openings);
    expect(fromOpenings[0].type).toBe("unfreeze");

    // buildControlsLog matches unfreeze instruction properly
    const { instructions } = parseInstructionsCsv(
      "ref,type,account,issued_at\nI10,unfreeze,FROZEN_HOLDER,2026-10-01T00:40:00Z\n",
    );
    const log = buildControlsLog(liftEvents, instructions, {
      asOf: "2026-10-02T00:00:00Z",
      initialFrozen: new Set(["FROZEN_HOLDER"]),
    });
    expect(log.records[0].type).toBe("unfreeze");
    expect(log.records[0].instruction?.ref).toBe("I10");
    expect(log.breaks).toEqual([]);
  });

  it("flags future-dated instructions as INSTRUCTION_IN_FUTURE breaks", () => {
    const { instructions } = parseInstructionsCsv(
      [
        "ref,type,account,issued_at",
        "I_FUTURE,freeze,A,2099-01-01T00:00:00Z",
        "I_NORMAL,freeze,B,2026-10-06T00:00:00Z",
      ].join("\n"),
    );
    const log = buildControlsLog([], instructions, {
      asOf: "2026-10-06T12:00:00Z",
    });
    expect(log.breaks).toContainEqual(
      expect.objectContaining({
        type: "INSTRUCTION_IN_FUTURE",
        severity: "medium",
        key: "INSTRUCTION_IN_FUTURE:I_FUTURE",
        address: "A",
        ref: "I_FUTURE",
      }),
    );
    // Normal pending instruction within window is in pending, not a future break
    expect(log.pending.map((i) => i.ref)).toEqual(["I_NORMAL"]);
    expect(log.breaks.filter((b) => b.type === "INSTRUCTION_IN_FUTURE")).toHaveLength(1);
  });

  it("does not pair an instruction dated after asOf with an earlier action as late", () => {
    // The freeze closes at 01:40; the approval is written one minute later, but asOf is 01:40:30,
    // so at asOf the approval does not exist yet. It is in the future, not a late approval.
    const { instructions } = parseInstructionsCsv(
      "ref,type,account,issued_at\nI11,freeze,A,2026-10-01T01:41:00Z\n",
    );
    const log = buildControlsLog(events.slice(1, 2), instructions, { asOf: "2026-10-01T01:40:30Z" });
    expect(log.breaks.map((b) => b.type).sort()).toEqual(["INSTRUCTION_IN_FUTURE", "UNINSTRUCTED_CONTROL"]);
    expect(log.pending).toEqual([]);
  });
});
