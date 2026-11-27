// Shift scheduling: who works which shift on which day, and how leave affects it.
// Pure functions over the Database snapshot, shared by the web app (lib/store.ts) and the API (lib/server).

import type { AppNotification, Database, Employee, LeaveRequest, LeaveType, ShiftAssignment, ShiftCode } from "./types";
import { addDays, displayName, formatShortDate } from "./format";
import { isWeekend, localToIso, zoned } from "./time";

export const DEFAULT_SCHEDULE_SETTINGS = { horizon_days: 60, short_notice_hours: 48 };
export const HORIZON_LIMITS = { min: 7, max: 180 };

export const assignmentId = (employeeId: string, date: string) => `${employeeId}:${date}`;

// ---- What someone is scheduled for ------------------------------------------------------

export interface DaySchedule {
  /** The shift that applies. On a default rest day this is still the person's usual code (payroll uses its time zone). */
  shift: ShiftCode | undefined;
  rest: boolean;
  working: boolean; // a shift to show up for
  source: "scheduled" | "default";
  assignment: ShiftAssignment | undefined;
}

const assignmentCache = new WeakMap<ShiftAssignment[], Map<string, ShiftAssignment>>();
function assignmentsIndex(db: Database) {
  const rows = db.shift_assignments ?? [];
  let m = assignmentCache.get(rows);
  if (!m) {
    m = new Map(rows.map((a) => [assignmentId(a.employee_id, a.work_date), a]));
    assignmentCache.set(rows, m);
  }
  return m;
}

/** The person's shift on a date: what operations scheduled, or their default shift code (weekdays) and weekend rest. */
export function scheduleFor(db: Database, e: Pick<Employee, "id" | "shift_code_id">, date: string): DaySchedule {
  const base = db.shift_codes.find((s) => s.id === e.shift_code_id);
  const a = assignmentsIndex(db).get(assignmentId(e.id, date));
  if (a) {
    const shift = a.shift_code_id ? db.shift_codes.find((s) => s.id === a.shift_code_id) : undefined;
    return { shift: shift ?? base, rest: !a.shift_code_id, working: !!shift, source: "scheduled", assignment: a };
  }
  const rest = isWeekend(date);
  return { shift: base, rest, working: !rest && !!base, source: "default", assignment: undefined };
}

/** Is this a scheduled workday (a shift, and not a holiday the person is off for)? Used to count leave days. */
export function isScheduledWorkday(db: Database, e: Pick<Employee, "id" | "shift_code_id">, date: string) {
  const s = scheduleFor(db, e, date);
  if (s.source === "default") return !s.rest; // no shift code: weekdays, as before scheduling existed
  return s.working;
}

// ---- Leave on a date --------------------------------------------------------------------

export interface DayLeave { request: LeaveRequest; type: LeaveType | undefined; status: "approved" | "pending" }

const leaveCache = new WeakMap<LeaveRequest[], Map<string, LeaveRequest[]>>();
function leaveIndex(db: Database) {
  let m = leaveCache.get(db.leave_requests);
  if (!m) {
    m = new Map();
    for (const r of db.leave_requests) {
      if (r.status !== "approved" && r.status !== "pending") continue;
      (m.get(r.employee_id) ?? m.set(r.employee_id, []).get(r.employee_id)!).push(r);
    }
    leaveCache.set(db.leave_requests, m);
  }
  return m;
}

/** Approved leave first, then pending. Covers every date in the request's range. */
export function leaveOn(db: Database, employeeId: string, date: string): DayLeave | undefined {
  const rows = (leaveIndex(db).get(employeeId) ?? []).filter((r) => r.start_date <= date && r.end_date >= date);
  const r = rows.find((x) => x.status === "approved") ?? rows[0];
  if (!r) return undefined;
  return { request: r, type: db.leave_types.find((t) => t.id === r.leave_type_id), status: r.status as DayLeave["status"] };
}

// ---- The calendar cell ------------------------------------------------------------------

export interface ScheduleCell {
  date: string;
  sched: DaySchedule;
  leave: DayLeave | undefined;
  /** Approved leave on a day operations scheduled a shift: the person won't be there and the shift needs cover. */
  gap: boolean;
  /** Filed less than short_notice_hours before the shift started. */
  shortNotice: boolean;
  /** Someone scheduled to fill in for this person on this day. */
  coveredBy: Employee | undefined;
  editable: boolean;
  lockReason: string | null;
}

export interface Window { today: string; last: string }
export const scheduleWindow = (db: Database, today: string): Window => ({ today, last: addDays(today, (db.schedule_settings ?? DEFAULT_SCHEDULE_SETTINGS).horizon_days) });

/** Why a day can't be scheduled, or null. `shift` is the code being assigned (null = rest day). */
export function lockReason(db: Database, e: Employee, date: string, today: string, shift?: ShiftCode | null): string | null {
  const w = scheduleWindow(db, today);
  if (date < today) return "Past days can’t be changed.";
  if (date > w.last) return `Only the next ${(db.schedule_settings ?? DEFAULT_SCHEDULE_SETTINGS).horizon_days} days can be scheduled.`;
  if (date < e.start_date) return `${displayName(e)} starts on ${formatShortDate(e.start_date)}.`;
  if (e.end_date && date > e.end_date) return `${displayName(e)}’s last day is ${formatShortDate(e.end_date)}.`;
  if (e.status === "offboarded") return `${displayName(e)} has left.`;
  if (db.payroll_periods.some((p) => p.status !== "open" && date >= p.start_date && date <= p.end_date)) return "Payroll for this date is finalized.";
  const lv = leaveOn(db, e.id, date);
  if (lv?.status === "approved") {
    // Approved half-day leave still leaves room for a half-day shift.
    if (lv.request.half_day && shift && shift.kind === "half_day") return null;
    return lv.request.half_day
      ? `${displayName(e)} has approved half-day leave. Only a half-day shift fits.`
      : `${displayName(e)} is on approved ${lv.type?.name.toLowerCase() ?? "leave"}.`;
  }
  return null;
}

const shiftStart = (shift: ShiftCode, date: string) => Date.parse(localToIso(date, shift.start_time, shift.timezone));

export function cellFor(db: Database, e: Employee, date: string, today: string, byId?: Map<string, Employee>): ScheduleCell {
  const sched = scheduleFor(db, e, date);
  const leave = leaveOn(db, e.id, date);
  const gap = !!leave && leave.status === "approved" && sched.working && sched.source === "scheduled" && !leave.request.half_day;
  const hours = (db.schedule_settings ?? DEFAULT_SCHEDULE_SETTINGS).short_notice_hours;
  const shortNotice = !!leave && !!sched.shift && sched.working && shiftStart(sched.shift, date) - Date.parse(leave.request.filed_at) < hours * 3600_000;
  const cover = gap ? (db.shift_assignments ?? []).find((a) => a.covers_employee_id === e.id && a.work_date === date && a.shift_code_id) : undefined;
  const coveredBy = cover ? (byId?.get(cover.employee_id) ?? db.employees.find((x) => x.id === cover.employee_id)) : undefined;
  const reason = lockReason(db, e, date, today);
  return { date, sched, leave, gap, shortNotice, coveredBy, editable: !reason || (!!leave?.request.half_day && leave.status === "approved"), lockReason: reason };
}

// ---- Who appears on the calendar ---------------------------------------------------------

export interface ScheduleFilter { department_id?: string | null; location_id?: string | null; client_id?: string | null; q?: string | null }

export function scheduledPeople(db: Database, from: string, to: string, f: ScheduleFilter = {}): Employee[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return db.employees
    .filter((e) => e.status !== "offboarded" && e.start_date <= to && (!e.end_date || e.end_date >= from))
    .filter((e) => (!f.department_id || e.department_id === f.department_id) && (!f.location_id || e.location_id === f.location_id) && (!f.client_id || e.client_id === f.client_id))
    .filter((e) => !q || `${e.first_name} ${e.last_name} ${e.preferred_name ?? ""} ${e.job_title}`.toLowerCase().includes(q))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

export const datesFrom = (from: string, days: number) => Array.from({ length: days }, (_, i) => addDays(from, i));

// ---- Assigning ---------------------------------------------------------------------------

export interface AssignmentInput { employee_id: string; work_date: string; shift_code_id: string | null; covers_employee_id?: string | null; note?: string | null }

/**
 * Checks a batch of assignments. All or nothing: returns errors keyed by `employee_id:date`,
 * and warnings for pending leave (allowed, but the scheduler should know).
 */
export function checkAssignments(db: Database, entries: AssignmentInput[], today: string) {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};
  for (const x of entries) {
    const key = assignmentId(x.employee_id, x.work_date);
    const e = db.employees.find((p) => p.id === x.employee_id);
    if (!e) { errors[key] = "Unknown employee."; continue; }
    const shift = x.shift_code_id ? db.shift_codes.find((s) => s.id === x.shift_code_id) : null;
    if (x.shift_code_id && (!shift || shift.archived_at)) { errors[key] = "Unknown or archived shift code."; continue; }
    const why = lockReason(db, e, x.work_date, today, shift);
    if (why) { errors[key] = why; continue; }
    if (x.covers_employee_id) {
      if (!shift) errors[key] = "A cover has to be a shift, not a rest day.";
      else if (x.covers_employee_id === x.employee_id) errors[key] = "Someone can’t cover for themselves.";
      else if (!db.employees.some((p) => p.id === x.covers_employee_id)) errors[key] = "Unknown person to cover for.";
    }
    const lv = leaveOn(db, e.id, x.work_date);
    if (lv?.status === "pending" && shift) warnings[key] = `${displayName(e)} has asked for ${lv.type?.name.toLowerCase() ?? "leave"} on this day. If it’s approved, you’ll be notified.`;
  }
  // Art. 91: a rest day of at least 24 hours after six consecutive workdays. Working it is allowed in the
  // cases Art. 92 lists, at the rest day premium, so this warns instead of refusing.
  if (!Object.keys(errors).length) {
    const after: Database = { ...db, shift_assignments: [...(db.shift_assignments ?? []).filter((a) => !entries.some((x) => assignmentId(x.employee_id, x.work_date) === a.id)), ...toAssignments("", entries, "", "")] };
    const flagged = new Set<string>();
    for (const x of entries) {
      if (!x.shift_code_id || flagged.has(x.employee_id)) continue;
      const e = db.employees.find((p) => p.id === x.employee_id)!;
      const run = consecutiveWorkdays(after, e, x.work_date);
      if (run > 6) {
        flagged.add(x.employee_id);
        const k = assignmentId(x.employee_id, x.work_date);
        warnings[k] = `${warnings[k] ? `${warnings[k]} ` : ""}${displayName(e)} would work ${run} days in a row. The Labor Code gives a rest day after six workdays (Art. 91); work on it is paid at least 30% more (Art. 93).`;
      }
    }
  }
  return { errors, warnings };
}

/** The run of consecutive working days through a date. */
export function consecutiveWorkdays(db: Database, e: Pick<Employee, "id" | "shift_code_id">, date: string): number {
  if (!scheduleFor(db, e, date).working) return 0;
  let n = 1;
  for (let d = addDays(date, -1); n < 14 && scheduleFor(db, e, d).working; d = addDays(d, -1)) n++;
  for (let d = addDays(date, 1); n < 14 && scheduleFor(db, e, d).working; d = addDays(d, 1)) n++;
  return n;
}

export function toAssignments(orgId: string, entries: AssignmentInput[], by: string, nowIso: string): ShiftAssignment[] {
  return entries.map((x) => ({
    id: assignmentId(x.employee_id, x.work_date), organization_id: orgId, employee_id: x.employee_id, work_date: x.work_date,
    shift_code_id: x.shift_code_id, covers_employee_id: x.covers_employee_id ?? null, note: x.note ?? null, assigned_by: by, assigned_at: nowIso,
  }));
}

/** People who could cover a gap: not working that day, not on leave, employed, and schedulable. Same client first, then branch. */
export function coverCandidates(db: Database, gapPerson: Employee, date: string, today: string): Employee[] {
  return db.employees
    .filter((e) => e.id !== gapPerson.id && e.status !== "offboarded" && e.status !== "on_leave")
    .filter((e) => !scheduleFor(db, e, date).working && !leaveOn(db, e.id, date) && !lockReason(db, e, date, today))
    .filter((e) => e.department_id === gapPerson.department_id || (gapPerson.client_id && e.client_id === gapPerson.client_id))
    .sort((a, b) =>
      Number(b.client_id === gapPerson.client_id && !!b.client_id) - Number(a.client_id === gapPerson.client_id && !!a.client_id)
      || Number(b.location_id === gapPerson.location_id) - Number(a.location_id === gapPerson.location_id)
      || displayName(a).localeCompare(displayName(b)));
}

// ---- Who gets told -----------------------------------------------------------------------

/** Shifts operations scheduled inside a leave request, from today on: the ones that will need cover. */
export function shiftsMissed(db: Database, r: LeaveRequest, today: string): { date: string; sched: DaySchedule }[] {
  const e = db.employees.find((x) => x.id === r.employee_id);
  if (!e) return [];
  const out: { date: string; sched: DaySchedule }[] = [];
  for (let d = r.start_date > today ? r.start_date : today; d <= r.end_date; d = addDays(d, 1)) {
    const sched = scheduleFor(db, e, d);
    if (sched.working && sched.source === "scheduled") out.push({ date: d, sched });
  }
  return out;
}

/** Operations, the person's manager, and whoever assigned the affected shifts. Never the person deciding or the person on leave. */
export function scheduleWatchers(db: Database, e: Employee, missed: { sched: DaySchedule }[], exclude: (string | null)[]): string[] {
  const ids = new Set<string>();
  for (const p of db.employees) if (p.role === "operations" && p.status !== "offboarded") ids.add(p.id);
  if (e.manager_id) ids.add(e.manager_id);
  for (const m of missed) if (m.sched.assignment) ids.add(m.sched.assignment.assigned_by);
  ids.delete(e.id);
  for (const x of exclude) if (x) ids.delete(x);
  return [...ids];
}

const range = (a: string, b: string) => (a === b ? formatShortDate(a) : `${formatShortDate(a)} – ${formatShortDate(b)}`);

/** Notifications when leave lands on scheduled shifts: on approval, and on filing when it's short notice. */
export function leaveNotifications(
  db: Database, r: LeaveRequest, event: "approved" | "filed", today: string, nowIso: string, newId: (p: string) => string, actorId: string | null,
): AppNotification[] {
  const e = db.employees.find((x) => x.id === r.employee_id);
  if (!e) return [];
  const missed = shiftsMissed(db, r, today);
  if (!missed.length) return [];
  const type = db.leave_types.find((t) => t.id === r.leave_type_id)?.name.toLowerCase() ?? "leave";
  const hours = (db.schedule_settings ?? DEFAULT_SCHEDULE_SETTINGS).short_notice_hours;
  const first = missed[0];
  const short = !!first.sched.shift && shiftStart(first.sched.shift, first.date) - Date.parse(r.filed_at) < hours * 3600_000;
  if (event === "filed" && !short) return [];
  const n = missed.length;
  const shifts = `${n} scheduled shift${n === 1 ? "" : "s"}`;
  const title = event === "approved"
    ? `${displayName(e)}’s ${type} was approved: ${shifts} need cover`
    : `${displayName(e)} asked for ${type} on short notice`;
  const body = event === "approved"
    ? `${range(r.start_date, r.end_date)}. ${n === 1 ? "The shift is" : "These shifts are"} now a coverage gap on the schedule.`
    : `${range(r.start_date, r.end_date)}, covering ${shifts}. It’s pending approval.`;
  return scheduleWatchers(db, e, missed, [actorId]).map((recipient) => ({
    id: newId("ntf"), organization_id: e.organization_id, recipient_id: recipient,
    kind: event === "approved" ? "leave_approved_on_shift" : "short_notice_leave",
    title, body, link: `/schedule?date=${first.date}`, employee_id: e.id, created_at: nowIso, read_at: null,
  }));
}

/** Coverage gaps in a range, for the side panel and the API. */
export function coverageGaps(db: Database, people: Employee[], dates: string[], today: string) {
  const byId = new Map(db.employees.map((e) => [e.id, e]));
  const out: { employee: Employee; cell: ScheduleCell }[] = [];
  for (const e of people) for (const d of dates) {
    if (d < today) continue;
    const cell = cellFor(db, e, d, today, byId);
    if (cell.gap) out.push({ employee: e, cell });
  }
  return out.sort((a, b) => a.cell.date.localeCompare(b.cell.date) || displayName(a.employee).localeCompare(displayName(b.employee)));
}

/**
 * The work date a time record belongs to. Overnight shifts belong to the day they started: a 2 AM time out
 * on a 10 PM shift counts for the day before, when that day's shift was overnight and has an open record.
 */
export function workDateFor(db: Database, emp: Pick<Employee, "id" | "shift_code_id">, iso: string): string {
  const base = db.shift_codes.find((s) => s.id === emp.shift_code_id);
  const z0 = zoned(iso, base?.timezone);
  const prev = addDays(z0.date, -1);
  const shift = scheduleFor(db, emp, prev).shift;
  if (shift && shift.end_time <= shift.start_time) {
    const [eh, em] = shift.end_time.split(":").map(Number);
    if (z0.minutes < eh * 60 + em + 4 * 60 && db.time_records.some((r) => r.employee_id === emp.id && r.work_date === prev)) return prev;
  }
  return z0.date;
}
