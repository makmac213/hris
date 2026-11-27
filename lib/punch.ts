// Time in and time out: what a punch may be, and how a day's punches become worked time.
// One set of rules for the web app (lib/store.ts) and the API (lib/server/services/time.ts).
// See docs/time-punches.md for every case.

import type { AppNotification, Database, Employee, TimeRecord, TimeRecordKind } from "./types";
import { addDays } from "./format";
import { scheduleFor, workDateFor } from "./schedule";
import { sessionsOf } from "./sessions";

export { intervals, overlapMs, sessionsOf, type DayPunches, type Session } from "./sessions";

export const PUNCH_RULES = {
  /** The same kind again within this many seconds is the same punch: a double tap, a retry, or a second device. */
  duplicateSeconds: 120,
  /** Time in and time out need at least this many seconds between them. */
  minGapSeconds: 60,
  /** More than this many punches on one work date needs a correction instead. */
  maxPunchesPerDay: 12,
  /** A device's offline queue can send punches up to this old. Older ones need a correction. */
  maxDeviceAgeHours: 72,
  /** A punch time this far ahead of the server clock is refused. */
  futureSkewSeconds: 120,
} as const;

export type PunchResult =
  | { ok: true; workDate: string; shiftCodeId: string | null; unclosed: string | null }
  | { ok: false; duplicate: TimeRecord }
  | { ok: false; status: 409 | 422; field: string; message: string };

const ms = (r: TimeRecord) => Date.parse(r.recorded_at);
const say = (kind: TimeRecordKind) => (kind === "clock_in" ? "time in" : "time out");
const devicePunches = (db: Database, employeeId: string) =>
  db.time_records.filter((r) => r.employee_id === employeeId && r.source === "device").sort((a, b) => ms(a) - ms(b));

/** Can this person record this punch at this time? `fromDevice` is a kiosk or offline queue that sends its own time. */
export function checkPunch(db: Database, emp: Employee, kind: TimeRecordKind, atIso: string, nowIso: string, fromDevice = false, fmt: (iso: string) => string = (s) => s): PunchResult {
  const at = Date.parse(atIso), now = Date.parse(nowIso);
  if (at > now + PUNCH_RULES.futureSkewSeconds * 1000) return { ok: false, status: 422, field: "recorded_at", message: "That time hasn't happened yet." };
  if (fromDevice && at < now - PUNCH_RULES.maxDeviceAgeHours * 3600_000) {
    return { ok: false, status: 422, field: "recorded_at", message: `This punch is more than ${PUNCH_RULES.maxDeviceAgeHours} hours old. File a time correction instead.` };
  }
  const all = devicePunches(db, emp.id);

  // Same punch again: return the first one instead of saving a second.
  const dup = all.find((r) => r.kind === kind && Math.abs(ms(r) - at) <= PUNCH_RULES.duplicateSeconds * 1000);
  if (dup) return { ok: false, duplicate: dup };

  const workDate = workDateFor(db, emp, atIso, kind);
  if (db.payroll_periods.some((p) => p.status !== "open" && workDate >= p.start_date && workDate <= p.end_date)) {
    return { ok: false, status: 409, field: "kind", message: "Payroll for this date is finalized. File a correction or ask HR for an adjustment." };
  }
  const day = all.filter((r) => r.work_date === workDate);
  if (day.length >= PUNCH_RULES.maxPunchesPerDay) {
    return { ok: false, status: 409, field: "kind", message: `There are already ${day.length} punches on this day. File a time correction instead.` };
  }
  const prev = [...day].reverse().find((r) => ms(r) <= at);
  const next = day.find((r) => ms(r) > at);
  const corrected = db.time_records.some((r) => r.employee_id === emp.id && r.work_date === workDate && r.source === "correction" && r.kind === kind);

  if (!prev && kind === "clock_out" && !corrected) return { ok: false, status: 409, field: "kind", message: "Record a time in first." };
  if (prev && prev.kind === kind) {
    return {
      ok: false, status: 409, field: "kind",
      message: kind === "clock_in" ? `You're already timed in since ${fmt(prev.recorded_at)}. Record your time out first.` : `You already timed out at ${fmt(prev.recorded_at)}. Time in again first.`,
    };
  }
  // An offline queue can arrive late: the punch must still alternate with what was recorded after it.
  if (next && next.kind === kind) return { ok: false, status: 409, field: "recorded_at", message: `This ${say(kind)} clashes with the ${say(next.kind)} at ${fmt(next.recorded_at)}. File a correction instead.` };
  const near = [prev, next].find((r) => r && Math.abs(ms(r) - at) < PUNCH_RULES.minGapSeconds * 1000);
  if (near) {
    const secs = Math.round(Math.abs(ms(near) - at) / 1000);
    return { ok: false, status: 409, field: "kind", message: `Your ${say(near.kind)} was ${secs} seconds ago. Wait at least a minute between time in and time out.` };
  }

  // Timing in while an earlier day was never timed out: that day stays open and is flagged for a fix.
  let unclosed: string | null = null;
  if (kind === "clock_in") {
    const before = all.filter((r) => r.work_date < workDate);
    const last = before[before.length - 1];
    const fixed = last && db.time_records.some((r) => r.employee_id === emp.id && r.work_date === last.work_date && r.source === "correction" && r.kind === "clock_out");
    if (last?.kind === "clock_in" && !fixed) unclosed = last.work_date;
  }
  const shiftCodeId = scheduleFor(db, emp, workDate).assignment?.shift_code_id ?? emp.shift_code_id;
  return { ok: true, workDate, shiftCodeId, unclosed };
}

/** The earlier work date this person timed in on and never timed out, if any (most recent first). */
export function unclosedDays(db: Database, employeeId: string, before: string, lookbackDays = 31): string[] {
  const from = addDays(before, -lookbackDays);
  const dates = [...new Set(db.time_records.filter((r) => r.employee_id === employeeId && r.work_date < before && r.work_date >= from).map((r) => r.work_date))];
  return dates.filter((d) => sessionsOf(db.time_records.filter((r) => r.employee_id === employeeId && r.work_date === d)).open).sort().reverse();
}

/** Tell the person, once, that an earlier day was never timed out and needs a correction. */
export function missingOutNotice(db: Database, emp: Employee, workDate: string, nowIso: string, id: string, orgId: string, fmtDate: (d: string) => string): AppNotification | null {
  const link = `/my-time?fix=${workDate}`;
  if (db.notifications.some((n) => n.recipient_id === emp.id && n.kind === "missing_time_out" && n.link === link)) return null;
  return {
    id, organization_id: orgId, recipient_id: emp.id, kind: "missing_time_out", employee_id: emp.id, created_at: nowIso, read_at: null, link,
    title: `No time out on ${fmtDate(workDate)}`,
    body: "That day is unpaid after your time in until a correction is approved. Request a fix with the time you left.",
  };
}
