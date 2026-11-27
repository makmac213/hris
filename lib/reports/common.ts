// Shared helpers: who is in scope, groups, dates, and one day of attendance worked out the way payroll does.

import type { Database, Employee } from "../types";
import { addDays, formatDate } from "../format";
import { leaveOn, scheduleFor } from "../schedule";
import { summarizeDay } from "../time";
import type { GroupBy, ReportParams } from "./types";

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const pct = (a: number, b: number) => (b > 0 ? r2((a / b) * 100) : 0);

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export const employedOn = (e: Employee, date: string) => e.start_date <= date && (!e.end_date || e.end_date >= date);

/** The org filters (department, branch, client) plus the viewer's scope. */
export function people(db: Database, p: ReportParams, scope: (e: Employee) => boolean): Employee[] {
  return db.employees.filter((e) => scope(e)
    && (!p.department_id || e.department_id === p.department_id)
    && (!p.location_id || e.location_id === p.location_id)
    && (!p.client_id || e.client_id === p.client_id));
}

export function groupOf(db: Database, e: Employee, by: GroupBy): string {
  if (by === "branch") return db.locations.find((l) => l.id === e.location_id)?.name ?? "No branch";
  if (by === "client") return db.clients.find((c) => c.id === e.client_id)?.name ?? "No client";
  return db.departments.find((d) => d.id === e.department_id)?.name ?? "No department";
}
export const groupLabel: Record<GroupBy, string> = { department: "Department", branch: "Branch", client: "Client" };

export function orgScope(db: Database, p: ReportParams): string {
  const bits = [
    p.department_id && db.departments.find((d) => d.id === p.department_id)?.name,
    p.location_id && db.locations.find((l) => l.id === p.location_id)?.name,
    p.client_id && db.clients.find((c) => c.id === p.client_id)?.name,
  ].filter(Boolean);
  return bits.length ? ` · ${bits.join(" · ")}` : "";
}
export const rangeText = (p: ReportParams) => `${formatDate(p.from)} to ${formatDate(p.to)}`;

export interface AttendanceDay {
  scheduled: boolean; present: boolean; absent: boolean; leave: boolean; holiday: boolean;
  lateMin: number; undertimeMin: number; noTimeOut: boolean;
}

/** One person, one past day: scheduled? present? on leave? late? Same sources as payroll: the schedule, approved leave, time records. */
export function attendanceDay(db: Database, e: Employee, date: string, recs: Map<string, import("../types").TimeRecord[]>, nowIso: string): AttendanceDay | null {
  if (!employedOn(e, date) || !e.shift_code_id || e.status === "onboarding") return null;
  const sc = scheduleFor(db, e, date);
  const holiday = db.holidays.some((h) => h.date === date && h.kind === "regular");
  const lv = leaveOn(db, e.id, date);
  const onLeave = lv?.status === "approved" && !lv.request.half_day;
  const records = recs.get(`${e.id}|${date}`) ?? [];
  if (!sc.working || holiday) {
    return records.length ? { scheduled: false, present: true, absent: false, leave: false, holiday, lateMin: 0, undertimeMin: 0, noTimeOut: false } : null;
  }
  if (onLeave) return { scheduled: true, present: false, absent: false, leave: true, holiday: false, lateMin: 0, undertimeMin: 0, noTimeOut: false };
  const s = summarizeDay(records, sc.shift, date, nowIso, false, false);
  const present = !!s.clockIn;
  return {
    scheduled: true, present, absent: !present && s.status === "absent", leave: false, holiday: false,
    lateMin: s.lateMinutes, undertimeMin: s.undertimeMinutes, noTimeOut: s.status === "missing_out",
  };
}

export function recordsIndex(db: Database) {
  const m = new Map<string, import("../types").TimeRecord[]>();
  for (const r of db.time_records) {
    const k = `${r.employee_id}|${r.work_date}`;
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
}

export interface AttendanceTotals { scheduled: number; present: number; absent: number; leave: number; late: number; lateMin: number; undertimeMin: number; noTimeOut: number }
export function attendanceFor(db: Database, e: Employee, dates: string[], recs: ReturnType<typeof recordsIndex>, nowIso: string): AttendanceTotals {
  const t: AttendanceTotals = { scheduled: 0, present: 0, absent: 0, leave: 0, late: 0, lateMin: 0, undertimeMin: 0, noTimeOut: 0 };
  for (const d of dates) {
    const a = attendanceDay(db, e, d, recs, nowIso);
    if (!a || !a.scheduled) continue;
    t.scheduled++;
    if (a.present) t.present++;
    if (a.absent) t.absent++;
    if (a.leave) t.leave++;
    if (a.lateMin > 0) { t.late++; t.lateMin += a.lateMin; }
    t.undertimeMin += a.undertimeMin;
    if (a.noTimeOut) t.noTimeOut++;
  }
  return t;
}
/** Present out of the days they were expected (scheduled, not on approved leave). */
export const attendanceRate = (t: AttendanceTotals) => pct(t.present, t.scheduled - t.leave);

export const monthsBack = (asOf: string, n: number) => {
  const out: string[] = [];
  const [y, m] = asOf.slice(0, 7).split("-").map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
};
export const monthEnd = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const monthLabel = (ym: string) => new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));
