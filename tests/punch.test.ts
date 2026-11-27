// Repeated time in and time out: what may be recorded, and how payroll counts it. Run with `npm test`.
// Fixture: one employee on a 9:00-18:00 shift (1-hour break, 5-minute grace), or 22:00-07:00 overnight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPunch, PUNCH_RULES, unclosedDays, type PunchResult } from "@/lib/punch";
import { computeDay, DEFAULT_SETTINGS } from "@/lib/payroll";
import { localToIso, summarizeDay } from "@/lib/time";
import { seed } from "@/lib/mock-data";
import type { Database, Employee, ShiftCode, TimeRecord, TimeRecordKind } from "@/lib/types";

const TZ = "Asia/Manila";
const DAY: ShiftCode = { id: "s-day", organization_id: "o", code: "D", name: "Day", kind: "whole_day", start_time: "09:00", end_time: "18:00", break_minutes: 60, timezone: TZ, grace_minutes: 5, source: "system_default", is_default: true, archived_at: null };
const NIGHT: ShiftCode = { ...DAY, id: "s-night", code: "N", start_time: "22:00", end_time: "07:00" };
const MON = "2027-03-01", TUE = "2027-03-02";
const at = (date: string, hm: string, sec = 0) => new Date(Date.parse(localToIso(date, hm, TZ)) + sec * 1000).toISOString();

function fixture(shift = DAY): { db: Database; emp: Employee } {
  const emp = { ...seed.employees.find((e) => e.id === "e16")!, id: "p1", shift_code_id: shift.id };
  return { emp, db: { ...seed, employees: [emp], shift_codes: [DAY, NIGHT], time_records: [], shift_assignments: [], payroll_periods: [], correction_requests: [], notifications: [], payroll_settings: DEFAULT_SETTINGS } };
}

let n = 0;
/** Try a punch at `iso`; on success, save it like the app does. */
function punch(f: { db: Database; emp: Employee }, kind: TimeRecordKind, iso: string, opts: { now?: string; device?: boolean } = {}): PunchResult {
  const r = checkPunch(f.db, f.emp, kind, iso, opts.now ?? iso, !!opts.device);
  if (r.ok) {
    const rec: TimeRecord = { id: `t${++n}`, organization_id: "o", employee_id: f.emp.id, shift_code_id: r.shiftCodeId, kind, recorded_at: iso, work_date: r.workDate, source: "device", correction_request_id: null, photo_path: "p", latitude: 0, longitude: 0, accuracy_m: 5, device: null };
    f.db = { ...f.db, time_records: [...f.db.time_records, rec] };
  }
  return r;
}
const refused = (r: PunchResult, re: RegExp) => { assert.ok(!r.ok && !("duplicate" in r), `expected a refusal, got ${JSON.stringify(r)}`); assert.match((r as { message: string }).message, re); };
const day = (f: { db: Database }, date: string, shift = DAY) =>
  computeDay(date, shift, f.db.time_records.filter((r) => r.work_date === date), [], [], { holidayOn: () => undefined, prevWorkdayPresent: true, nowMs: Date.parse("2027-12-31T00:00:00Z"), managerial: false });

test("a double tap or a retry is the same punch: the first one stands", () => {
  const f = fixture();
  assert.ok(punch(f, "clock_in", at(MON, "08:55")).ok);
  const again = punch(f, "clock_in", at(MON, "08:55", 3));
  assert.ok(!again.ok && "duplicate" in again, "second tap returns the first record");
  const retry = punch(f, "clock_in", at(MON, "08:56", 50));
  assert.ok(!retry.ok && "duplicate" in retry, "within two minutes");
  assert.equal(f.db.time_records.length, 1);
});

test("a second device timing the same person in at the same moment adds nothing", () => {
  const f = fixture();
  punch(f, "clock_in", at(MON, "09:00"));
  const kiosk = punch(f, "clock_in", at(MON, "09:01"), { device: true });
  assert.ok(!kiosk.ok && "duplicate" in kiosk);
  assert.equal(f.db.time_records.length, 1);
});

test("time in then time out seconds later is refused; at least a minute apart", () => {
  const f = fixture();
  punch(f, "clock_in", at(MON, "09:00"));
  refused(punch(f, "clock_out", at(MON, "09:00", 20)), /20 seconds ago/);
  assert.ok(punch(f, "clock_out", at(MON, "09:01", 5)).ok);
});

test("two time ins in a row, or a time out with no time in, are refused with what to do", () => {
  const f = fixture();
  refused(punch(f, "clock_out", at(MON, "09:00")), /time in first/i);
  punch(f, "clock_in", at(MON, "09:00"));
  refused(punch(f, "clock_in", at(MON, "09:30")), /already timed in since/);
  punch(f, "clock_out", at(MON, "12:00"));
  refused(punch(f, "clock_out", at(MON, "12:30")), /already timed out at .* Time in again first/);
});

test("in, out, in, out a few minutes apart: allowed, and payroll counts only the time in between", () => {
  const f = fixture();
  for (const [k, hm] of [["clock_in", "09:00"], ["clock_out", "09:03"], ["clock_in", "09:06"], ["clock_out", "18:00"]] as const) assert.ok(punch(f, k, at(MON, hm)).ok, `${k} ${hm}`);
  const d = day(f, MON);
  // 3 + 534 minutes inside the schedule; the 3 minutes away count toward the 60-minute break, so nothing is lost.
  assert.equal(d.workedMin, 480);
  assert.equal(d.undertimeMin, 0);
  assert.equal(d.lateMin, 0);
  assert.equal(summarizeDay(f.db.time_records, DAY, MON, at(MON, "19:00")).sessions.length, 2);
});

test("a lunch break punched out and in: no break deducted twice", () => {
  const f = fixture();
  for (const [k, hm] of [["clock_in", "09:00"], ["clock_out", "12:00"], ["clock_in", "13:00"], ["clock_out", "18:00"]] as const) punch(f, k, at(MON, hm));
  const d = day(f, MON);
  assert.equal(d.workedMin, 480);
  assert.equal(d.undertimeMin, 0);
});

test("a time out by mistake mid-morning, back two hours later: the extra hour away is undertime", () => {
  const f = fixture();
  for (const [k, hm] of [["clock_in", "09:00"], ["clock_out", "10:00"], ["clock_in", "12:00"], ["clock_out", "18:00"]] as const) punch(f, k, at(MON, hm));
  const d = day(f, MON);
  assert.equal(d.workedMin, 420, "two hours away, one of them the break");
  assert.equal(d.undertimeMin, 60);
});

test("forgot to time out, then timed in the next day: the next day starts fresh and the first is flagged", () => {
  const f = fixture();
  punch(f, "clock_in", at(MON, "09:00"));
  const next = punch(f, "clock_in", at(TUE, "08:58"));
  assert.ok(next.ok);
  assert.equal(next.ok && next.workDate, TUE);
  assert.equal(next.ok && next.unclosed, MON, "Monday is reported so the person is told");
  assert.deepEqual(unclosedDays(f.db, f.emp.id, TUE), [MON]);
  assert.equal(summarizeDay(f.db.time_records.filter((r) => r.work_date === MON), DAY, MON, at(TUE, "09:00")).status, "missing_out");
  const mon = day(f, MON);
  assert.ok(mon.incomplete);
  assert.equal(mon.workedMin, 0, "unpaid past the time in until a correction");
  // An approved "missing time out" correction closes it.
  const fix: TimeRecord = { ...f.db.time_records[0], id: "fix", kind: "clock_out", source: "correction", recorded_at: at(MON, "18:05"), correction_request_id: "cr1", photo_path: null };
  f.db = { ...f.db, time_records: [...f.db.time_records, fix] };
  assert.equal(day(f, MON).workedMin, 480);
  assert.deepEqual(unclosedDays(f.db, f.emp.id, TUE), []);
});

test("overnight: the time out after midnight belongs to the night it started; the next night is a new day", () => {
  const f = fixture(NIGHT);
  punch(f, "clock_in", at(MON, "21:58"));
  const out = punch(f, "clock_out", at(TUE, "07:02"));
  assert.equal(out.ok && out.workDate, MON);
  const back = punch(f, "clock_in", at(TUE, "21:57"));
  assert.equal(back.ok && back.workDate, TUE);
  assert.equal(day(f, MON, NIGHT).workedMin, 480);
});

test("overnight break: out at 2 AM and back at 3 AM stays on the same night", () => {
  const f = fixture(NIGHT);
  punch(f, "clock_in", at(MON, "22:00"));
  punch(f, "clock_out", at(TUE, "02:00"));
  const back = punch(f, "clock_in", at(TUE, "03:00"));
  assert.equal(back.ok && back.workDate, MON);
  punch(f, "clock_out", at(TUE, "07:00"));
  assert.equal(day(f, MON, NIGHT).workedMin, 480);
});

test("overnight, forgot to time out, timed in the next morning: a new day, not a second time in on the night", () => {
  const f = fixture(NIGHT);
  punch(f, "clock_in", at(MON, "22:00"));
  const morning = punch(f, "clock_in", at(TUE, "09:00"));
  assert.ok(morning.ok);
  assert.equal(morning.ok && morning.workDate, TUE);
  assert.equal(morning.ok && morning.unclosed, MON);
});

test("offline devices: an old punch needs a correction; a late upload can't clash with later punches", () => {
  const f = fixture();
  const now = at(MON, "18:00");
  refused(punch(f, "clock_in", at("2027-02-25", "09:00"), { now, device: true }), /more than 72 hours old/);
  refused(punch(f, "clock_in", at(MON, "18:10"), { now }), /hasn't happened yet/);
  punch(f, "clock_in", at(MON, "09:00"), { now, device: true });
  punch(f, "clock_out", at(MON, "17:00"), { now, device: true });
  // A queued time out from 12:00 arrives after the 17:00 one: it would leave two outs in a row.
  refused(punch(f, "clock_out", at(MON, "12:00"), { now, device: true }), /clashes with the time out/);
});

test("punches far outside the schedule: only scheduled time is paid; the rest is flagged unless overtime is approved", () => {
  const f = fixture();
  punch(f, "clock_in", at(MON, "05:00"));
  punch(f, "clock_out", at(MON, "21:00"));
  const d = day(f, MON);
  assert.equal(d.workedMin, 480);
  assert.equal(d.otMin, 0);
  assert.equal(d.unapprovedExtraMin, 180, "after 18:00, not filed; arriving early isn't flagged");
});

test("too many punches in a day needs a correction", () => {
  const f = fixture();
  for (let i = 0; i < PUNCH_RULES.maxPunchesPerDay; i++) assert.ok(punch(f, i % 2 ? "clock_out" : "clock_in", at(MON, `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`)).ok);
  refused(punch(f, "clock_in", at(MON, "16:00")), /File a time correction/);
});

test("a stray time out (no time in before it, from old data) is kept but not paid", () => {
  const f = fixture();
  const stray: TimeRecord = { id: "s", organization_id: "o", employee_id: "p1", shift_code_id: "s-day", kind: "clock_out", recorded_at: at(MON, "08:00"), work_date: MON, source: "device", correction_request_id: null, photo_path: "p", latitude: 0, longitude: 0, accuracy_m: 5, device: null };
  f.db = { ...f.db, time_records: [stray] };
  punch(f, "clock_in", at(MON, "09:00"));
  punch(f, "clock_out", at(MON, "18:00"));
  assert.equal(day(f, MON).workedMin, 480);
});
