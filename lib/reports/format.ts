// How report values read on screen.

import { formatDate } from "../format";
import { formatDuration, formatInstant } from "../time";
import { peso } from "../payroll";
import type { Cell, ValueKind } from "./types";

export function formatValue(v: Cell | undefined, kind: ValueKind): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string" && kind !== "date" && kind !== "datetime") return v;
  const n = Number(v);
  switch (kind) {
    case "money": return peso(n);
    case "percent": return `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "minutes": return n ? formatDuration(n) : "0m";
    case "hours": return `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;
    case "days": return `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} day${n === 1 ? "" : "s"}`;
    case "date": return formatDate(String(v));
    case "datetime": return `${formatDate(String(v).slice(0, 10))}, ${formatInstant(String(v))}`;
    case "number": return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    default: return String(v);
  }
}

/** Short form for chart axes and labels: 1.2K, ₱3.4M. */
export function compact(n: number, kind: ValueKind): string {
  const c = (x: number) => x.toLocaleString("en-US", { notation: Math.abs(x) >= 10000 ? "compact" : "standard", maximumFractionDigits: Math.abs(x) >= 10000 ? 1 : 0 });
  if (kind === "money") return `₱${c(n)}`;
  if (kind === "percent") return `${Math.round(n)}%`;
  if (kind === "minutes") return formatDuration(Math.round(n));
  return c(n);
}

export const numericKinds: ValueKind[] = ["number", "money", "percent", "minutes", "hours", "days"];
