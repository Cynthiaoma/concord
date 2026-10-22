/** Minimal RFC 4180 reader and writer. Registers arrive as CSV exports from TA systems. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
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
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
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
  const records = rows.slice(1).map((r, i) => {
    const values: Record<string, string> = {};
    headers.forEach((h, j) => {
      values[h] = (r[j] ?? "").trim();
    });
    return { line: i + 2, values };
  });
  return { headers, records };
}

function escape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(escape).join(",")];
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(","));
  return lines.join("\n") + "\n";
}
