// Scheduling rules over the sample company. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "@/lib/mock-data";
import { addDays } from "@/lib/format";
import { requestDays } from "@/lib/leave";
import { cellFor, checkAssignments, coverageGaps, coverCandidates, datesFrom, leaveNotifications, scheduleFor, toAssignments } from "@/lib/schedule";
import type { Database, LeaveRequest } from "@/lib/types";

// The seed is built around today: Paul's sick leave (lv-10) starts on it.
const TODAY = seed.leave_requests.find((r) => r.id === "lv-10")!.start_date;
const emp = (db: Database, id: string) => db.employees.find((e) => e.id === id)!;
const nextWeekday = (from: string, wd: number) => { let d = from; while (new Date(`${d}T00:00:00Z`).getUTCDay() !== wd) d = addDays(d, 1); return d; };
const clone = (): Database => structuredClone(seed);
let n = 0;
const id = (p: string) => `${p}-t${++n}`;

test("no schedule: default shift on weekdays, rest on weekends", () => {
  const e = emp(seed, "e13");
  const mon = nextWeekday(addDays(TODAY, 1), 1), sat = nextWeekday(TODAY, 6);
  assert.equal(scheduleFor(seed, e, mon).working, true);
  assert.equal(scheduleFor(seed, e, mon).source, "default");
  assert.equal(scheduleFor(seed, e, sat).working, false);
});

test("a published schedule overrides the default: Kestrel Bank works Saturdays and rests Mondays", () => {
  const e = emp(seed, "e48");
  const sat = nextWeekday(addDays(TODAY, 1), 6), mon = nextWeekday(addDays(TODAY, 1), 1);
  assert.equal(scheduleFor(seed, e, sat).working, true);
  assert.equal(scheduleFor(seed, e, sat).source, "scheduled");
  assert.equal(scheduleFor(seed, e, mon).working, false);
});

test("leave counts the person's scheduled workdays, not Monday to Friday", () => {
  const sat = nextWeekday(addDays(TODAY, 1), 6);
  const mon = addDays(sat, 2);
  // Noel (Kestrel) works Saturday, rests Sunday and Monday: Sat–Mon is one day of leave.
  assert.equal(requestDays(seed, { employee_id: "e48", leave_type_id: "lt-vl", start_date: sat, end_date: mon, half_day: false }), 1);
  // Someone on the default schedule: Saturday and Sunday off, Monday counts.
  const holiday = seed.holidays.some((h) => h.date === mon && h.kind !== "special_working");
  assert.equal(requestDays(seed, { employee_id: "e13", leave_type_id: "lt-vl", start_date: sat, end_date: mon, half_day: false }), holiday ? 0 : 1);
});

test("approved leave blocks a shift; pending leave allows it with a warning", () => {
  const approved = seed.leave_requests.find((r) => r.id === "lv-12")!; // Cherry Mae, vacation leave
  const pending = seed.leave_requests.find((r) => r.id === "lv-11")!; // Joanna, vacation leave
  const r = checkAssignments(seed, [
    { employee_id: "e46", work_date: approved.start_date, shift_code_id: "sc-ph-d0700" },
    { employee_id: "e46", work_date: approved.start_date, shift_code_id: null },
  ], TODAY);
  assert.match(r.errors[`e46:${approved.start_date}`], /approved vacation leave/);
  const ok = checkAssignments(seed, [{ employee_id: "e44", work_date: pending.start_date, shift_code_id: "sc-ph-d0700" }], TODAY);
  assert.deepEqual(ok.errors, {});
  assert.match(ok.warnings[`e44:${pending.start_date}`], /asked for vacation leave/);
});

test("approved half-day leave leaves room for a half-day shift only", () => {
  const db = clone();
  const d = nextWeekday(addDays(TODAY, 3), 3);
  db.leave_requests.push({ id: "lv-half", employee_id: "e13", leave_type_id: "lt-vl", start_date: d, end_date: d, half_day: true, reason: "x", status: "approved", filed_at: `${TODAY}T00:00:00Z`, decided_by: "e06", decided_at: `${TODAY}T01:00:00Z`, decision_note: null });
  assert.ok(checkAssignments(db, [{ employee_id: "e13", work_date: d, shift_code_id: "sc-ph-d0900" }], TODAY).errors[`e13:${d}`]);
  assert.deepEqual(checkAssignments(db, [{ employee_id: "e13", work_date: d, shift_code_id: "sc-ph-h0800" }], TODAY).errors, {});
});

test("only today through the scheduling window can be changed", () => {
  const last = addDays(TODAY, seed.schedule_settings.horizon_days);
  const r = checkAssignments(seed, [
    { employee_id: "e42", work_date: addDays(TODAY, -1), shift_code_id: "sc-ph-d2200" },
    { employee_id: "e42", work_date: last, shift_code_id: "sc-ph-d2200" },
    { employee_id: "e42", work_date: addDays(last, 1), shift_code_id: "sc-ph-d2200" },
  ], TODAY);
  assert.match(r.errors[`e42:${addDays(TODAY, -1)}`], /Past days/);
  assert.equal(r.errors[`e42:${last}`], undefined);
  assert.match(r.errors[`e42:${addDays(last, 1)}`], /next 60 days/);
});

test("sudden sick leave on a scheduled shift is a coverage gap until someone covers it", () => {
  const db = clone();
  const people = db.employees.filter((e) => e.department_id === "dep-ops");
  const gaps = coverageGaps(db, people, datesFrom(TODAY, 7), TODAY);
  const paul = gaps.find((g) => g.employee.id === "e43" && g.cell.date === TODAY);
  assert.ok(paul, "Paul's shift today is a gap");
  assert.equal(paul.cell.shortNotice, true);
  const cand = coverCandidates(db, emp(db, "e43"), TODAY, TODAY);
  assert.ok(cand.length > 0);
  assert.ok(cand.every((c) => !scheduleFor(db, c, TODAY).working), "candidates are off that day");
  db.shift_assignments.push(...toAssignments(db.employees[0].organization_id, [{ employee_id: cand[0].id, work_date: TODAY, shift_code_id: "sc-ph-d2200", covers_employee_id: "e43" }], "e40", `${TODAY}T08:00:00Z`));
  assert.equal(cellFor(db, emp(db, "e43"), TODAY, TODAY).coveredBy?.id, cand[0].id);
});

test("approving leave on scheduled shifts notifies operations, the manager and the scheduler, not the approver", () => {
  const db = clone();
  const pending = db.leave_requests.find((r) => r.id === "lv-11")!;
  const approved: LeaveRequest = { ...pending, status: "approved", decided_by: "e45", decided_at: `${TODAY}T09:00:00Z` };
  db.leave_requests = db.leave_requests.map((r) => (r.id === approved.id ? approved : r));
  const sent = leaveNotifications(db, approved, "approved", TODAY, `${TODAY}T09:00:00Z`, id, "e45");
  const to = new Set(sent.map((x) => x.recipient_id));
  assert.ok(to.has("e39") && to.has("e40"), "operations");
  assert.ok(!to.has("e45"), "not the approver (who is also the manager)");
  assert.ok(!to.has("e44"), "not the person on leave");
  assert.match(sent[0].title, /approved/);
  assert.equal(cellFor(db, emp(db, "e44"), pending.start_date, TODAY).gap, true);
});

test("leave filed well ahead tells no one until it's approved; short notice tells operations at once", () => {
  const db = clone();
  const far: LeaveRequest = { id: "lv-far", employee_id: "e42", leave_type_id: "lt-vl", start_date: addDays(TODAY, 10), end_date: addDays(TODAY, 10), half_day: false, reason: "x", status: "pending", filed_at: `${TODAY}T01:00:00Z`, decided_by: null, decided_at: null, decision_note: null };
  db.leave_requests.push(far);
  if (scheduleFor(db, emp(db, "e42"), far.start_date).working) assert.equal(leaveNotifications(db, far, "filed", TODAY, far.filed_at, id, null).length, 0);
  const lv13 = db.leave_requests.find((r) => r.id === "lv-13")!; // Kristine, emergency leave for tonight
  assert.ok(leaveNotifications(db, lv13, "filed", TODAY, lv13.filed_at, id, null).some((x) => x.kind === "short_notice_leave"));
});

test("leave on days nobody scheduled sends nothing", () => {
  const lv = seed.leave_requests.find((r) => r.id === "lv-7")!; // an engineer on the default schedule
  assert.equal(leaveNotifications(seed, { ...lv, status: "approved" }, "approved", TODAY, `${TODAY}T00:00:00Z`, id, "e07").length, 0);
});

test("a seventh workday in a row is allowed but warned (Labor Code Art. 91)", () => {
  // Noel (Kestrel) works Tuesday to Saturday. Scheduling his Sunday and Monday too makes seven.
  const sun = nextWeekday(addDays(TODAY, 8), 0); // a week inside the published schedule
  const r = checkAssignments(seed, [
    { employee_id: "e48", work_date: sun, shift_code_id: "sc-ph-d0700" },
    { employee_id: "e48", work_date: addDays(sun, 1), shift_code_id: "sc-ph-d0700" },
  ], TODAY);
  assert.deepEqual(r.errors, {});
  assert.ok(Object.values(r.warnings).some((w) => /Art\. 91/.test(w)));
  const fine = checkAssignments(seed, [{ employee_id: "e48", work_date: sun, shift_code_id: "sc-ph-d0700" }], TODAY);
  assert.ok(!Object.values(fine.warnings).some((w) => /Art\. 91/.test(w)), "six in a row is fine");
});
