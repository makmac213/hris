import type { ShiftCode, ShiftKind, TimeRecord } from "./types";

export const ORG_TZ = "Asia/Manila";

// ---- Clock helpers ---------------------------------------------------------

export const toMinutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

export const fromMinutes = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function formatClock(hm: string): string {
  const min = toMinutes(hm);
  const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const spanMinutes = (s: Pick<ShiftCode, "start_time" | "end_time">) =>
  (toMinutes(s.end_time) - toMinutes(s.start_time) + 1440) % 1440;

export const isOvernight = (s: Pick<ShiftCode, "start_time" | "end_time">) => toMinutes(s.end_time) <= toMinutes(s.start_time);

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const shiftHours = (s: ShiftCode) => `${formatClock(s.start_time)} – ${formatClock(s.end_time)}${isOvernight(s) ? " (next day)" : ""}`;

/** Wall-clock date and minutes for an instant in a time zone. */
export function zoned(iso: string | number | Date, tz = ORG_TZ): { date: string; minutes: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: wd };
}

export const formatInstant = (iso: string, tz = ORG_TZ) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));

/** Converts a local wall-clock date+time in a zone to a UTC ISO string (zones without DST, like Manila, are exact). */
export function localToIso(date: string, hm: string, tz = ORG_TZ): string {
  const guess = Date.parse(`${date}T${hm}:00Z`);
  const z = zoned(guess, tz);
  const offset = (Date.parse(`${z.date}T${fromMinutes(z.minutes)}:00Z`) - guess) / 60000;
  return new Date(guess - offset * 60000).toISOString();
}

export const isWeekend = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

// ---- Philippine default schedule ------------------------------------------
// Whole-day: 9 hours on site = 8 paid hours + 1 hour unpaid meal break (Labor Code, Art. 83 and 85).
// Half-day: 4 hours, no break.

export const PH_DEFAULTS: { kind: ShiftKind; start: string; label: string }[] = [
  { kind: "whole_day", start: "06:00", label: "Early day shift" },
  { kind: "whole_day", start: "07:00", label: "Day shift" },
  { kind: "whole_day", start: "08:00", label: "Day shift" },
  { kind: "whole_day", start: "09:00", label: "Day shift" },
  { kind: "whole_day", start: "10:00", label: "Late day shift" },
  { kind: "whole_day", start: "14:00", label: "Mid shift" },
  { kind: "whole_day", start: "22:00", label: "Night shift" },
  { kind: "half_day", start: "08:00", label: "Morning half-day" },
  { kind: "half_day", start: "13:00", label: "Afternoon half-day" },
];

export const DEFAULT_SPAN: Record<ShiftKind, { span: number; break: number }> = {
  whole_day: { span: 9 * 60, break: 60 },
  half_day: { span: 4 * 60, break: 0 },
};

export function phDefaultCodes(orgId: string): ShiftCode[] {
  return PH_DEFAULTS.map((d) => {
    const { span, break: brk } = DEFAULT_SPAN[d.kind];
    const code = `PH-${d.kind === "whole_day" ? "D" : "H"}${d.start.replace(":", "")}`;
    return {
      id: `sc-${code.toLowerCase()}`,
      organization_id: orgId,
      code,
      name: `${d.label}, ${formatClock(d.start)}`,
      kind: d.kind,
      start_time: d.start,
      end_time: fromMinutes(toMinutes(d.start) + span),
      break_minutes: brk,
      timezone: ORG_TZ,
      grace_minutes: 5,
      source: "system_default",
      is_default: d.kind === "whole_day" && d.start === "08:00",
      archived_at: null,
    };
  });
}

export const shiftKindLabel: Record<ShiftKind, string> = { whole_day: "Whole day", half_day: "Half day" };

// ---- Daily attendance ------------------------------------------------------

export type DayStatus = "rest_day" | "upcoming" | "not_in" | "absent" | "working" | "done" | "missing_out" | "no_shift" | "on_leave";

export interface DaySummary {
  status: DayStatus;
  clockIn: TimeRecord | undefined;
  clockOut: TimeRecord | undefined;
  lateMinutes: number; // 0 when on time or within grace
  undertimeMinutes: number;
  workedMinutes: number;
  records: TimeRecord[];
}

/** Records for one employee on one work date, summarized against their shift. */
export function summarizeDay(records: TimeRecord[], shift: ShiftCode | undefined, date: string, nowIso: string, onLeave = false): DaySummary {
  const sorted = [...records].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  // An approved correction overrides the device record of the same kind; originals are never edited.
  const latestCorrection = (k: TimeRecord["kind"]) => [...sorted].reverse().find((r) => r.kind === k && r.source === "correction");
  const clockIn = latestCorrection("clock_in") ?? sorted.find((r) => r.kind === "clock_in");
  const clockOut = latestCorrection("clock_out") ?? [...sorted].reverse().find((r) => r.kind === "clock_out");
  const base = { clockIn, clockOut, records: sorted, lateMinutes: 0, undertimeMinutes: 0, workedMinutes: 0 };
  if (onLeave) return { ...base, status: "on_leave" };
  if (!shift) return { ...base, status: clockIn ? (clockOut ? "done" : "working") : "no_shift" };

  const startIso = localToIso(date, shift.start_time, shift.timezone);
  const endIso = new Date(Date.parse(startIso) + spanMinutes(shift) * 60000).toISOString();
  const now = Date.parse(nowIso);

  if (!clockIn) {
    if (isWeekend(date)) return { ...base, status: "rest_day" };
    if (now < Date.parse(startIso)) return { ...base, status: "upcoming" };
    return { ...base, status: now > Date.parse(endIso) ? "absent" : "not_in" };
  }

  const late = Math.round((Date.parse(clockIn.recorded_at) - Date.parse(startIso)) / 60000);
  const lateMinutes = late > shift.grace_minutes ? late : 0;
  const outAt = clockOut ? Date.parse(clockOut.recorded_at) : Math.min(now, Date.parse(endIso));
  const gross = Math.max(0, (outAt - Date.parse(clockIn.recorded_at)) / 60000);
  const workedMinutes = Math.max(0, gross - (gross > 5 * 60 ? shift.break_minutes : 0));
  const undertimeMinutes = clockOut ? Math.max(0, Math.round((Date.parse(endIso) - Date.parse(clockOut.recorded_at)) / 60000)) : 0;
  const status: DayStatus = clockOut ? "done" : now > Date.parse(endIso) + 2 * 3600_000 ? "missing_out" : "working";
  return { ...base, status, lateMinutes, undertimeMinutes, workedMinutes };
}

export const dayStatusLabel: Record<DayStatus, string> = {
  rest_day: "Rest day",
  upcoming: "Shift not started",
  not_in: "Not timed in",
  absent: "Absent",
  working: "Timed in",
  done: "Timed out",
  missing_out: "No time out",
  no_shift: "No shift code",
  on_leave: "On leave",
};

// ---- CSV upload ------------------------------------------------------------

export interface ParsedRow {
  line: number;
  value?: Omit<ShiftCode, "id" | "organization_id" | "source" | "is_default" | "archived_at">;
  errors: string[];
}

function parseTime(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m && +m[1] < 24 && +m[2] < 60) return `${m[1].padStart(2, "0")}:${m[2]}`;
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +(m[2] ?? 0) < 60) {
    const h = (+m[1] % 12) + (m[3] === "PM" ? 12 : 0);
    return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
  }
  return null;
}

export const CSV_TEMPLATE = `code,name,type,start,end,break_minutes
OPS-D0730,Operations day shift,whole_day,07:30,16:30,60
OPS-N2100,Operations night shift,whole_day,21:00,06:00,60
OPS-H0730,Operations morning half-day,half_day,07:30,11:30,0`;

/** Parses an uploaded schedule CSV. Columns: code, name, type, start, end, break_minutes (optional). */
export function parseShiftCsv(text: string, existingCodes: Set<string>): ParsedRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const hasHeader = header.includes("code");
  const idx = (name: string, fallback: number) => (hasHeader ? header.indexOf(name) : fallback);
  const col = { code: idx("code", 0), name: idx("name", 1), type: idx("type", 2), start: idx("start", 3), end: idx("end", 4), brk: idx("break_minutes", 5) };
  const seen = new Set<string>();

  return lines.slice(hasHeader ? 1 : 0).map((line, i) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const errors: string[] = [];
    const code = (cells[col.code] ?? "").toUpperCase();
    const name = cells[col.name] ?? "";
    const typeRaw = (cells[col.type] ?? "").toLowerCase().replace(/[\s-]/g, "_");
    const kind: ShiftKind | null = typeRaw === "whole_day" || typeRaw === "half_day" ? typeRaw : null;
    const start = parseTime(cells[col.start] ?? "");
    const end = parseTime(cells[col.end] ?? "");
    const brk = col.brk >= 0 && cells[col.brk] ? Number(cells[col.brk]) : kind ? DEFAULT_SPAN[kind].break : 0;

    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) errors.push("Code must be 2–20 letters, digits or dashes");
    else if (existingCodes.has(code)) errors.push(`${code} already exists`);
    else if (seen.has(code)) errors.push(`${code} appears twice in this file`);
    if (!name) errors.push("Name is empty");
    if (!kind) errors.push("Type must be whole_day or half_day");
    if (!start) errors.push("Start isn’t a time like 08:00 or 8:00 AM");
    if (!end) errors.push("End isn’t a time like 17:00 or 5:00 PM");
    if (start && end && start === end) errors.push("Start and end are the same");
    if (!Number.isFinite(brk) || brk < 0 || brk > 240) errors.push("Break must be 0–240 minutes");
    if (start && end && Number.isFinite(brk) && start !== end && spanMinutes({ start_time: start, end_time: end }) <= brk) errors.push("Break is longer than the shift");
    seen.add(code);

    return {
      line: i + (hasHeader ? 2 : 1),
      errors,
      value: errors.length ? undefined : { code, name, kind: kind!, start_time: start!, end_time: end!, break_minutes: brk, timezone: ORG_TZ, grace_minutes: 5 },
    };
  });
}
