/** Minimal RFC 4180 reader and writer. Registers arrive as CSV exports from TA systems. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += c;
      }
    } else if (afterQuote && (c === " " || c === "\t")) {
      // Ignore optional spaces after a closed quoted field.
    } else if (afterQuote && c !== "," && c !== "\n" && c !== "\r") {
      const lines = src.slice(0, i).split(/\r\n|\r|\n/);
      const column = lines[lines.length - 1]!.length + 1;
      throw new Error("unexpected character after closing quote at line " + lines.length + ", column " + column);
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      afterQuote = false;
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error("unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export interface CsvTable {
  headers: string[];
  records: Array<{ line: number; values: Record<string, string> }>;
}

/** Parse with a header row. Header names are lower-cased and spaces become underscores. */
export function parseCsvTable(text: string): CsvTable {
  const rows = parseCsv(text);
  const head = rows[0];
  if (!head) throw new Error("empty CSV");
  const headers = head.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const seen = new Map<string, number>();
  headers.forEach((h, index) => {
    if (!h) return;
    const previous = seen.get(h);
    if (previous !== undefined) {
      throw new Error('duplicate column "' + h + '" (columns ' + previous + ' and ' + (index + 1) + ')');
    }
    seen.set(h, index + 1);
  });
  const records = rows.slice(1).map((r, i) => {
    // Untrusted header names must not inherit or mutate Object.prototype.
    const values: Record<string, string> = Object.create(null);
    headers.forEach((h, j) => {
      if (!h) return; // Empty header slots have no corresponding column name.
      values[h] = (r[j] ?? "").trim();
    });
    return { line: i + 2, values };
  });
  return { headers, records };
}

function escape(value: unknown): string {
  let s: string;
  if (value === null || value === undefined) {
    s = "";
  } else if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("cannot export invalid Date to CSV");
    s = value.toISOString();
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot export non-finite number to CSV");
    s = String(value);
  } else if (typeof value === "object") {
    throw new Error("cannot export object or array to CSV");
  } else {
    s = String(value);
  }
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(escape).join(",")];
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(","));
  return lines.join("\n") + "\n";
}
