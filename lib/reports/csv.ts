// CSV export: one row per table row, totals last. Text a spreadsheet might run as a formula is quoted with a leading '.

import type { Cell, ReportResult } from "./types";

const FORMULA = /^[=+\-@\t\r]/;
function field(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  let s = String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(r: ReportResult): string {
  const lines = [r.columns.map((c) => field(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => field(row[c.key] ?? null)).join(","));
  if (r.totals) lines.push(r.columns.map((c) => field(r.totals![c.key] ?? null)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export const csvFilename = (key: string, scope: string, at: string) =>
  `${key}_${scope.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}_${at.slice(0, 16).replace(/[:T]/g, "")}.csv`;
