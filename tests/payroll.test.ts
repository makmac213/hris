// Edge cases for the Philippine payroll engine. Run with `npm test`.
// Fixture: one monthly-paid employee, ₱30,000/month, 9:00–18:00 shift with a 1-hour break, 5-minute grace.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS, RULES, computePayslip, monthlyContributions, periodFor, sssMsc, thirteenthMonthPay, withholdingSemiMonthly, type Payslip,
} from "@/lib/payroll";
import { localToIso } from "@/lib/time";
import { STATUTORY_LEAVES, grantedDays, leaveBalance, leaveTypesFor, validateLeave } from "@/lib/leave";
import { creditedYears, legalStatus, probationEndFor } from "@/lib/employment";
import { finalPay, retirementPay, separationPay } from "@/lib/finalpay";
import { annualTax } from "@/lib/yearend";
import type { Compensation, Database, Employee, Holiday, OvertimeRequest, PayItem, PayItemType, PayrollPeriod, PayrollSettings, ShiftCode, TimeRecord, LeaveType, LeaveRequest, PayrollOpening } from "@/lib/types";

const TZ = "Asia/Manila";
const DAY: ShiftCode = { id: "s-day", organization_id: "o", code: "PH-D0900", name: "Day", kind: "whole_day", start_time: "09:00", end_time: "18:00", break_minutes: 60, timezone: TZ, grace_minutes: 5, source: "system_default", is_default: true, archived_at: null };
const NIGHT: ShiftCode = { ...DAY, id: "s-night", code: "PH-N2200", start_time: "22:00", end_time: "07:00" };
const NOW = "2027-01-31T00:00:00Z"; // every test day is in the past

function emp(over: Partial<Employee> = {}): Employee {
  return { id: "e1", organization_id: "o", employee_number: "1", first_name: "Ana", last_name: "Cruz", preferred_name: null, pronouns: null, work_email: "a@x", phone: null, job_title: "Analyst", department_id: null, location_id: null, manager_id: null, employment_type: "full_time", status: "active", start_date: "2025-01-01", end_date: null, avatar_url: null, role: "employee", shift_code_id: "s-day",
    employment_status_ph: "regular", probation_end_date: null, standards_given_on: "2025-01-01", contract_end_date: null, regularized_on: "2025-06-30", birth_date: null, separation_reason: null, separation_notice_date: null, ...over } as Employee;
}
function comp(over: Partial<Compensation> = {}): Compensation {
  return { id: "c1", employee_id: "e1", pay_basis: "monthly", rate: 30000, is_managerial: false, on_ph_payroll: true, effective_from: "2025-01-01", ...over };
}
let rid = 0;
function rec(date: string, inHm: string | null, outHm: string | null, opts: { outNextDay?: boolean; source?: "device" | "correction" } = {}): TimeRecord[] {
  const base = { organization_id: "o", employee_id: "e1", shift_code_id: "s-day", work_date: date, source: opts.source ?? "device", correction_request_id: opts.source === "correction" ? "cr" : null, photo_path: "p", latitude: 0, longitude: 0, accuracy_m: 5, device: null } as const;
  const out: TimeRecord[] = [];
  if (inHm) out.push({ ...base, id: `r${++rid}`, kind: "clock_in", recorded_at: localToIso(date, inHm, TZ) });
  if (outHm) {
    const d = opts.outNextDay ? new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10) : date;
    out.push({ ...base, id: `r${++rid}`, kind: "clock_out", recorded_at: localToIso(d, outHm, TZ) });
  }
  return out;
}
const weekdays = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
};
/** Full attendance on every weekday in [from, to] except the listed dates. */
function present(from: string, to: string, except: string[] = [], shift = DAY): TimeRecord[] {
  return weekdays(from, to).filter((d) => !except.includes(d)).flatMap((d) => shift === NIGHT ? rec(d, "21:58", "07:00", { outNextDay: true }) : rec(d, "08:58", "18:00"));
}
function ot(date: string, from: string, to: string, status: OvertimeRequest["status"] = "approved", toNextDay = false): OvertimeRequest {
  const toDate = toNextDay ? new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10) : date;
  return { id: `ot${++rid}`, employee_id: "e1", work_date: date, start_at: localToIso(date, from, TZ), end_at: localToIso(toDate, to, TZ), reason: "Release work", status, filed_at: NOW, decided_by: "m", decided_at: NOW, decision_note: null };
}
function payItem(over: Partial<PayItem>): PayItem {
  return { id: `pi${++rid}`, type_id: null, employee_id: "e1", direction: "earning", category: "taxable_allowance", de_minimis_kind: null, label: "Item", amount: 1000, schedule: "every_cutoff", start_date: "2026-01-01", end_date: null, installments: null, authorization: null, created_by: "hr", created_at: NOW, ...over };
}
function db(o: { employee?: Partial<Employee>; comp?: Partial<Compensation>; records?: TimeRecord[]; ot?: OvertimeRequest[]; holidays?: Holiday[]; settings?: Partial<PayrollSettings>; items?: PayItem[]; overrides?: Database["employee_payroll_settings"]; shifts?: ShiftCode[]; types?: PayItemType[]; leaveTypes?: LeaveType[]; leave?: LeaveRequest[]; openings?: PayrollOpening[] } = {}): Database {
  return {
    departments: [], locations: [], employees: [emp(o.employee)], employment_events: [], employee_documents: [], onboarding_template_tasks: [], onboarding_cases: [], onboarding_tasks: [],
    shift_codes: o.shifts ?? [DAY, NIGHT], time_records: o.records ?? [], compensation: [comp(o.comp)], holidays: o.holidays ?? [], overtime_requests: o.ot ?? [], correction_requests: [], payroll_periods: [],
    payroll_settings: { ...DEFAULT_SETTINGS, sss_basis: "monthly_rate", ...o.settings }, employee_payroll_settings: o.overrides ?? [], pay_items: o.items ?? [], pay_item_types: o.types ?? [],
    leave_types: o.leaveTypes ?? [], leave_requests: o.leave ?? [], leave_adjustments: [], payroll_openings: o.openings ?? [],
  };
}
const P = (date: string): PayrollPeriod => ({ ...periodFor(date), status: "open", finalized_at: null, finalized_by: null });
function slip(d: Database, date: string): Payslip {
  const s = computePayslip(d, d.employees[0], P(date), NOW);
  assert.ok(s, "expected a payslip");
  return s;
}
const line = (ls: { key: string; amount: number }[], prefix: string) => ls.filter((l) => l.key.startsWith(prefix)).reduce((n, l) => n + l.amount, 0);
const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 0.02, `${msg ?? ""} expected ${b.toFixed(2)}, got ${a.toFixed(2)}`);

const DAILY = (30000 * 12) / 261; // ₱1,379.31
const HOURLY = DAILY / 8; // ₱172.41
const MIN = HOURLY / 60;
// Nov 16–30, 2026 has 11 weekdays. Nov 2–13 (first cutoff) is used where holidays must be avoided.
const A0 = "2026-11-02", A1 = "2026-11-13";
const B0 = "2026-11-16", B1 = "2026-11-30";

// ---- Attendance -------------------------------------------------------------

test("full attendance pays exactly half the monthly salary", () => {
  const s = slip(db({ records: present(B0, B1) }), B0);
  near(s.gross, 15000);
  assert.equal(s.deductions.length, 0);
});

test("late within the grace period is not deducted; past it, every minute is", () => {
  const d1 = db({ records: [...present(A0, A1, ["2026-11-04"]), ...rec("2026-11-04", "09:04", "18:00")] });
  assert.equal(line(slip(d1, A0).deductions, "late"), 0);
  const d2 = db({ records: [...present(A0, A1, ["2026-11-04"]), ...rec("2026-11-04", "09:20", "18:00")] });
  near(line(slip(d2, A0).deductions, "late"), 20 * MIN);
});

test("an absence deducts one scheduled day", () => {
  const s = slip(db({ records: present(A0, A1, ["2026-11-05"]) }), A0);
  near(line(s.deductions, "absent"), DAILY);
});

test("absent for the whole cutoff: deductions are capped at basic pay", () => {
  const s = slip(db({ records: [] }), B0);
  assert.ok(s.gross >= 0, "gross can't go negative");
  near(s.gross, 0);
  assert.ok(s.flags.some((f) => f.includes("capped")));
});

test("a day with a time in but no time out is unpaid and flagged", () => {
  const s = slip(db({ records: [...present(A0, A1, ["2026-11-06"]), ...rec("2026-11-06", "09:00", null)] }), A0);
  near(line(s.deductions, "undertime"), 8 * HOURLY);
  assert.ok(s.flags.some((f) => f.includes("no time out")));
});

test("an approved correction replaces the device record", () => {
  const records = [...present(A0, A1, ["2026-11-06"]), ...rec("2026-11-06", "09:40", "18:00"), ...rec("2026-11-06", "09:00", null, { source: "correction" })];
  assert.equal(line(slip(db({ records }), A0).deductions, "late"), 0);
});

// ---- Overtime ---------------------------------------------------------------

test("time outside the schedule without an approved request is not paid", () => {
  const s = slip(db({ records: [...present(A0, A1, ["2026-11-04"]), ...rec("2026-11-04", "08:58", "21:00")] }), A0);
  assert.equal(line(s.earnings, "ot-"), 0);
  assert.ok(s.flags.some((f) => f.includes("without approved overtime")));
});

test("approved overtime pays only the minutes the records cover, at 125%", () => {
  const s = slip(db({ records: [...present(A0, A1, ["2026-11-04"]), ...rec("2026-11-04", "08:58", "19:00")], ot: [ot("2026-11-04", "18:00", "20:00")] }), A0);
  near(line(s.earnings, "ot-"), 60 * MIN * 1.25);
});

test("pending or rejected overtime is not paid", () => {
  const records = [...present(A0, A1, ["2026-11-04"]), ...rec("2026-11-04", "08:58", "20:00")];
  assert.equal(line(slip(db({ records, ot: [ot("2026-11-04", "18:00", "20:00", "pending")] }), A0).earnings, "ot-"), 0);
  assert.equal(line(slip(db({ records, ot: [ot("2026-11-04", "18:00", "20:00", "rejected")] }), A0).earnings, "ot-"), 0);
});

test("undertime can't be offset by overtime on another day (Art. 88)", () => {
  const records = [...present(A0, A1, ["2026-11-04", "2026-11-05"]), ...rec("2026-11-04", "08:58", "17:00"), ...rec("2026-11-05", "08:58", "19:00")];
  const s = slip(db({ records, ot: [ot("2026-11-05", "18:00", "19:00")] }), A0);
  near(line(s.deductions, "undertime"), 60 * MIN);
  near(line(s.earnings, "ot-"), 60 * MIN * 1.25);
});

test("rest-day work: first 8 hours at 130%, the rest at 169%", () => {
  const records = [...present(A0, A1), ...rec("2026-11-07", "08:00", "18:00")]; // Saturday
  const s = slip(db({ records, ot: [ot("2026-11-07", "08:00", "18:00")] }), A0);
  near(line(s.earnings, "ot-"), 480 * MIN * 1.3 + 120 * MIN * 1.69);
});

test("night differential on overtime is 10% of the overtime rate", () => {
  const records = [...present(A0, A1, ["2026-11-04"]), ...rec("2026-11-04", "08:58", "23:00")];
  const s = slip(db({ records, ot: [ot("2026-11-04", "18:00", "23:00")] }), A0);
  near(line(s.earnings, "nsd"), 60 * MIN * 1.25 * 0.1);
});

// ---- Holidays ---------------------------------------------------------------

const H = (date: string, kind: Holiday["kind"] = "regular"): Holiday => ({ date, name: "Test holiday", kind });

test("unworked regular holiday, present the workday before: paid in the monthly salary", () => {
  const s = slip(db({ records: present(A0, A1, ["2026-11-11"]), holidays: [H("2026-11-11")] }), A0);
  near(s.gross, 15000);
});

test("unworked regular holiday, absent the workday before: not paid", () => {
  const s = slip(db({ records: present(A0, A1, ["2026-11-10", "2026-11-11"]), holidays: [H("2026-11-11")] }), A0);
  near(line(s.deductions, "absent"), DAILY);
  near(line(s.deductions, "holiday-ineligible"), DAILY);
});

test("Monday holiday: presence is judged on Friday, skipping the weekend", () => {
  const s = slip(db({ records: present(A0, A1, ["2026-11-06", "2026-11-09"]), holidays: [H("2026-11-09")] }), A0);
  near(line(s.deductions, "holiday-ineligible"), DAILY);
});

test("successive holidays: absent before the first but worked it, so the second is paid", () => {
  const holidays = [H("2026-11-12"), H("2026-11-13")];
  const worked = slip(db({ records: [...present(A0, A1, ["2026-11-11", "2026-11-12", "2026-11-13"]), ...rec("2026-11-12", "08:58", "18:00")], holidays }), A0);
  assert.equal(line(worked.deductions, "holiday-ineligible"), 0);
  const notWorked = slip(db({ records: present(A0, A1, ["2026-11-11", "2026-11-12", "2026-11-13"]), holidays }), A0);
  near(line(notWorked.deductions, "holiday-ineligible"), 2 * DAILY);
});

test("holiday on the first day of a cutoff looks back into the previous cutoff", () => {
  const records = present("2026-11-02", "2026-11-30", ["2026-11-13", "2026-11-16"]);
  const s = slip(db({ records, holidays: [H("2026-11-16")] }), B0);
  near(line(s.deductions, "holiday-ineligible"), DAILY);
});

test("hourly staff: unworked regular holiday is paid 100% when eligible", () => {
  const s = slip(db({ comp: { pay_basis: "hourly", rate: 150 }, records: present(A0, A1, ["2026-11-11"]), holidays: [H("2026-11-11")] }), A0);
  near(line(s.earnings, "holiday-unworked"), 8 * 150);
});

test("working a regular holiday adds a 100% premium; a special day adds 30%", () => {
  const reg = slip(db({ records: present(A0, A1), holidays: [H("2026-11-11")] }), A0);
  near(line(reg.earnings, "prem-regular"), 8 * HOURLY);
  const spc = slip(db({ records: present(A0, A1), holidays: [H("2026-11-11", "special_non_working")] }), A0);
  near(line(spc.earnings, "prem-special"), 8 * HOURLY * 0.3);
});

test("special working days are ordinary days", () => {
  const s = slip(db({ records: present(A0, A1), holidays: [H("2026-11-11", "special_working")] }), A0);
  assert.equal(line(s.earnings, "prem-"), 0);
});

test("unworked special day: paid by default (company policy), deducted when the setting is off", () => {
  const records = present(A0, A1, ["2026-11-11"]);
  const holidays = [H("2026-11-11", "special_non_working")];
  near(slip(db({ records, holidays }), A0).gross, 15000);
  near(line(slip(db({ records, holidays, settings: { pay_unworked_special_days: false } }), A0).deductions, "special-unworked"), DAILY);
});

test("a night shift that crosses midnight into a holiday gets the premium only for the holiday hours", () => {
  // Tue Nov 10, 22:00 → Wed Nov 11, 07:00; Nov 11 is a regular holiday. Shift hours after midnight: 7 of 9, net of break.
  const holidays = [H("2026-11-11")];
  const records = present(A0, A1, ["2026-11-11"], NIGHT);
  const s = slip(db({ employee: { shift_code_id: "s-night" }, records, holidays }), A0);
  const scale = 8 / 9;
  // Nov 10's shift: 7 raw hours on the holiday. Nov 11's own shift (22:00 on the holiday) wasn't worked: unworked holiday, paid.
  near(line(s.earnings, "prem-regular"), 7 * 60 * scale * MIN);
});

// ---- Managerial staff -------------------------------------------------------

test("managerial staff: no overtime pay or premiums, and no tardiness deductions by default", () => {
  const records = [...present(A0, A1, ["2026-11-04"]), ...rec("2026-11-04", "09:30", "21:00")];
  const s = slip(db({ comp: { is_managerial: true }, records, ot: [ot("2026-11-04", "18:00", "21:00")], holidays: [H("2026-11-11")] }), A0);
  assert.equal(line(s.earnings, "ot-"), 0);
  assert.equal(line(s.earnings, "prem-"), 0);
  assert.equal(line(s.deductions, "late"), 0);
  const strict = slip(db({ comp: { is_managerial: true }, records, settings: { deduct_managerial_tardiness: true } }), A0);
  near(line(strict.deductions, "late"), 30 * MIN);
});

// ---- Contributions ----------------------------------------------------------

test("SSS salary credit brackets", () => {
  assert.equal(sssMsc(3000), 5000);
  assert.equal(sssMsc(5249.99), 5000);
  assert.equal(sssMsc(5250), 5500);
  assert.equal(sssMsc(30000), 30000);
  assert.equal(sssMsc(34750), 35000);
  assert.equal(sssMsc(80000), 35000);
});

test("PhilHealth floor and ceiling, Pag-IBIG cap and low-pay rate", () => {
  near(monthlyContributions(8000).phEe, 250);
  near(monthlyContributions(150000).phEe, 2500);
  near(monthlyContributions(50000).pagEe, 200);
  near(monthlyContributions(1500).pagEe, 15);
});

test("split timing: half of the month each cutoff", () => {
  const s = slip(db({ records: present(B0, B1) }), B0);
  near(line(s.contributions, "sss"), 750);
  near(line(s.contributions, "philhealth"), 375);
  near(line(s.contributions, "pagibig"), 100);
});

test("second-cutoff timing: nothing on the 1st–15th, the whole month on the 16th–end", () => {
  const settings = { contribution_timing: "second_cutoff" as const };
  assert.equal(slip(db({ records: present(A0, B1), settings }), A0).contributions.length, 0);
  near(line(slip(db({ records: present(A0, B1), settings }), B0).contributions, "sss"), 1500);
});

test("SSS on actual compensation is trued up on the second cutoff", () => {
  // Overtime in the first cutoff raises the month's compensation above ₱30,000.
  const records = [...present("2026-11-02", B1, ["2026-11-04"]), ...rec("2026-11-04", "08:58", "22:00")];
  const d = db({ records, ot: [ot("2026-11-04", "18:00", "22:00")], settings: { sss_basis: "actual_compensation" } });
  const a = slip(d, A0), b = slip(d, B0);
  const monthComp = a.compensationForSss + b.compensationForSss;
  near(line(a.contributions, "sss") + line(b.contributions, "sss"), sssMsc(monthComp) * 0.05, "month total");
});

test("a joiner in the second half pays the whole month's contributions there", () => {
  const s = slip(db({ employee: { start_date: "2026-11-18" }, records: present("2026-11-18", B1) }), B0);
  near(line(s.contributions, "sss"), 1500);
});

test("company-paid employee share: not deducted, shown as employer cost, and taxable", () => {
  const base = slip(db({ records: present(B0, B1) }), B0);
  const paid = slip(db({ records: present(B0, B1), overrides: [{ employee_id: "e1", employer_pays_sss: true, employer_pays_philhealth: null, employer_pays_pagibig: null, pagibig_voluntary: 0 }] }), B0);
  assert.equal(line(paid.contributions, "sss"), 0);
  near(line(paid.employer, "sss-ee-by-er"), 750);
  near(paid.taxable, base.taxable + 750 + 750); // not deducted from taxable, and added as compensation
});

test("voluntary Pag-IBIG is deducted after tax", () => {
  const base = slip(db({ records: present(B0, B1) }), B0);
  const vol = slip(db({ records: present(B0, B1), overrides: [{ employee_id: "e1", employer_pays_sss: null, employer_pays_philhealth: null, employer_pays_pagibig: null, pagibig_voluntary: 1000 }] }), B0);
  near(vol.taxable, base.taxable);
  near(base.net - vol.net, 500);
});

test("the daily-rate divisor follows the company setting", () => {
  const s = slip(db({ records: present(A0, A1, ["2026-11-05"]), settings: { workdays_per_year: 313 } }), A0);
  near(line(s.deductions, "absent"), (30000 * 12) / 313);
});

// ---- Tax --------------------------------------------------------------------

test("withholding tax table boundaries", () => {
  assert.equal(withholdingSemiMonthly(10417), 0);
  near(withholdingSemiMonthly(16667), 937.5);
  near(withholdingSemiMonthly(33333), 4270.7);
  near(withholdingSemiMonthly(83333), 16770.7);
});

test("minimum wage earner: exempt on wage and overtime, taxed only on other income", () => {
  const mweRate = (RULES.minimumWage.daily * 261) / 12;
  const records = [...present(B0, B1, ["2026-11-18"]), ...rec("2026-11-18", "08:58", "21:00")];
  const s = slip(db({ comp: { rate: mweRate }, records, ot: [ot("2026-11-18", "18:00", "21:00")] }), B0);
  assert.equal(s.mwe, true);
  assert.equal(s.tax, 0);
  const withAllowance = slip(db({ comp: { rate: mweRate }, records: present(B0, B1), items: [payItem({ amount: 12000 })] }), B0);
  near(withAllowance.tax, (12000 - 10417) * 0.15);
});

test("below minimum wage is flagged", () => {
  const s = slip(db({ comp: { rate: 15000 }, records: present(B0, B1) }), B0);
  assert.ok(s.flags.some((f) => f.includes("below")));
});

// ---- Allowances and benefits ------------------------------------------------

test("de minimis within the ceiling is tax-free; the excess goes to the ₱90,000 pool", () => {
  const rice = payItem({ category: "de_minimis", de_minimis_kind: "rice", amount: 1500, label: "Rice" });
  const a = slip(db({ records: present("2026-11-02", B1), items: [rice] }), A0);
  const b = slip(db({ records: present("2026-11-02", B1), items: [rice] }), B0);
  near(a.nonTaxable, 1500);
  near(b.nonTaxable, 1500); // ₱500 over the ₱2,500 monthly ceiling, but still inside the ₱90,000 pool
  assert.ok(b.additions[0].detail?.includes("over"));
});

test("benefits past ₱90,000 in the year are taxed", () => {
  const items = [
    payItem({ category: "other_benefit", amount: 85000, schedule: "once", start_date: "2026-06-01", label: "Mid-year bonus" }),
    payItem({ category: "other_benefit", amount: 10000, schedule: "once", start_date: "2026-11-20", label: "Year-end bonus" }),
  ];
  const s = slip(db({ records: present(B0, B1), items }), B0);
  const base = slip(db({ records: present(B0, B1) }), B0);
  near(s.taxable - base.taxable, 5000);
});

test("reimbursements are not taxed and not part of SSS compensation", () => {
  const base = slip(db({ records: present(B0, B1) }), B0);
  const s = slip(db({ records: present(B0, B1), items: [payItem({ category: "reimbursement", amount: 2000, schedule: "once", start_date: B0 })] }), B0);
  near(s.taxable, base.taxable);
  near(s.compensationForSss, base.compensationForSss);
  near(s.gross - base.gross, 2000);
});

// ---- Deductions -------------------------------------------------------------

test("a deduction that needs authorization is skipped without one; statutory loans don't need one", () => {
  const items = [
    payItem({ direction: "deduction", category: "company_loan", amount: 1000, label: "Cash advance" }),
    payItem({ direction: "deduction", category: "sss_loan", amount: 800, label: "SSS loan" }),
  ];
  const s = slip(db({ records: present(B0, B1), items }), B0);
  near(line(s.otherDeductions, "ded-"), 800);
  assert.ok(s.flags.some((f) => f.includes("authorization")));
});

test("deductions beyond what pay covers carry over; net pay never goes negative", () => {
  const items = [payItem({ direction: "deduction", category: "company_loan", amount: 40000, authorization: "signed" })];
  const s = slip(db({ records: present(B0, B1), items }), B0);
  near(s.net, 0);
  assert.ok(s.deferred.length > 0);
});

test("loss or damage deductions are capped at 20% of wages", () => {
  const items = [payItem({ direction: "deduction", category: "loss_damage", amount: 5000, authorization: "hearing on file" })];
  const s = slip(db({ records: present(B0, B1), items }), B0);
  near(line(s.otherDeductions, "ded-"), 3000);
});

test("loan installments stop after the last one", () => {
  const loan = (start: string) => payItem({ direction: "deduction", category: "sss_loan", amount: 500, installments: 3, start_date: start });
  assert.ok(slip(db({ records: present(B0, B1), items: [loan("2026-10-16")] }), B0).otherDeductions[0].detail?.includes("3 of 3"));
  assert.equal(slip(db({ records: present(B0, B1), items: [loan("2026-10-01")] }), B0).otherDeductions.length, 0);
});

// ---- 13th month -------------------------------------------------------------

test("13th month: one twelfth of basic pay, prorated for joiners, at least a month of service", () => {
  near(thirteenthMonthPay(db(), emp(), 2026), 30000);
  near(thirteenthMonthPay(db({ employee: { start_date: "2026-07-01" } }), emp({ start_date: "2026-07-01" }), 2026), 30000 * (184 / 365));
  assert.equal(thirteenthMonthPay(db({ employee: { start_date: "2026-12-15" } }), emp({ start_date: "2026-12-15" }), 2026), 0);
});

test("13th month goes on the December 1–15 payroll, and managers only by company policy", () => {
  const s = slip(db({ records: present("2026-12-01", "2026-12-15") }), "2026-12-01");
  near(line(s.additions, "13th"), 30000);
  const mgr = db({ comp: { is_managerial: true }, settings: { thirteenth_month_for_managerial: false } });
  assert.equal(thirteenthMonthPay(mgr, emp(), 2026), 0);
});

// ---- Company-defined pay types ----------------------------------------------

function ptype(over: Partial<PayItemType>): PayItemType {
  return { id: "t1", name: "Meal allowance", direction: "earning", category: "taxable_allowance", de_minimis_kind: null, description: null, default_amount: 1000, default_schedule: "every_cutoff", applies_to: "all", counts_for_13th: false, is_statutory: false, active: true, ...over };
}

test("a company-wide type reaches everyone eligible without per-person items", () => {
  const s = slip(db({ records: present(B0, B1), types: [ptype({})] }), B0);
  near(line(s.additions, "add-auto-t1"), 1000);
  const mgr = slip(db({ comp: { is_managerial: true }, records: present(B0, B1), types: [ptype({ applies_to: "rank_and_file" })] }), B0);
  assert.equal(mgr.additions.length, 0);
});

test("a person's own item overrides the company default; 0 excludes them", () => {
  const own = (amount: number) => payItem({ type_id: "t1", amount });
  near(line(slip(db({ records: present(B0, B1), types: [ptype({})], items: [own(400)] }), B0).additions, "add-"), 400);
  assert.equal(slip(db({ records: present(B0, B1), types: [ptype({})], items: [own(0)] }), B0).additions.length, 0);
});

test("the type's legal treatment wins over what's stored on the item", () => {
  const types = [ptype({ category: "de_minimis", de_minimis_kind: "rice", applies_to: "individual" })];
  const s = slip(db({ records: present(B0, B1), types, items: [payItem({ type_id: "t1", category: "taxable_allowance", amount: 1000 })] }), B0);
  near(s.nonTaxable, 1000);
});

test("company-wide deductions are never applied without the person's own item", () => {
  const s = slip(db({ records: present(B0, B1), types: [ptype({ direction: "deduction", category: "other_authorized" })] }), B0);
  assert.equal(s.otherDeductions.length, 0);
});

test("an inactive type stops applying", () => {
  assert.equal(slip(db({ records: present(B0, B1), types: [ptype({ active: false })] }), B0).additions.length, 0);
});

test("company practice can add a type to the 13th month base", () => {
  const types = [ptype({ counts_for_13th: true, default_amount: 1000 })]; // 24 cutoffs × ₱1,000
  near(thirteenthMonthPay(db({ types }), emp(), 2026), (30000 * 12 + 24000) / 12);
});


// ---- Leave, employment terms, final pay and year-end tax ---------------------------

const VL: LeaveType = { ...STATUTORY_LEAVES[0], id: "lt-vl", name: "Vacation leave", statutory: false, legal_basis: null, legal_min_days: 0, days: 15, accrual: "monthly", min_service_months: 6, convertible: true, carry_over_max: 5, counts_as_sil: true };
const LWOP: LeaveType = { ...VL, id: "lt-lwop", name: "Leave without pay", days: 30, accrual: "per_event", paid: false, convertible: false, counts_as_sil: false, carry_over_max: 0, min_service_months: 0 };
const leaveTypes = [...STATUTORY_LEAVES, VL, LWOP];
function lv(type: string, start: string, end = start, over: Partial<LeaveRequest> = {}): LeaveRequest {
  return { id: `lv${++rid}`, employee_id: "e1", leave_type_id: type, start_date: start, end_date: end, half_day: false, reason: "r", status: "approved", filed_at: NOW, decided_by: "m", decided_at: NOW, decision_note: null, ...over };
}

test("an approved paid leave day is not an absence", () => {
  const full = slip(db({ records: present(B0, B1) }), B0);
  const s = slip(db({ records: present(B0, B1, ["2026-11-18"]), leave: [lv("lt-vl", "2026-11-18")], leaveTypes }), B0);
  assert.equal(line(s.deductions, "absent"), 0);
  near(s.gross, full.gross);
});

test("leave without pay is deducted like an absence and labeled", () => {
  const s = slip(db({ records: present(B0, B1, ["2026-11-18"]), leave: [lv("lt-lwop", "2026-11-18")], leaveTypes }), B0);
  near(line(s.deductions, "lwop"), DAILY);
  assert.equal(line(s.deductions, "absent"), 0);
});

test("a paid half-day leave covers the afternoon: leaving at 1 PM costs nothing", () => {
  const recs = [...present(B0, B1, ["2026-11-18"]), ...rec("2026-11-18", "08:58", "13:00")];
  const s = slip(db({ records: recs, leave: [lv("lt-vl", "2026-11-18", "2026-11-18", { half_day: true })], leaveTypes }), B0);
  near(line(s.deductions, "undertime"), 0);
});

test("paid leave on the workday before a regular holiday keeps the holiday paid (hourly)", () => {
  const hol: Holiday[] = [{ date: "2026-11-30", name: "Bonifacio Day", kind: "regular" }];
  const s = slip(db({ comp: { pay_basis: "hourly", rate: 120 }, records: present(B0, "2026-11-26"), holidays: hol, leave: [lv("lt-vl", "2026-11-27")], leaveTypes }), B0);
  assert.ok(line(s.earnings, "holiday-unworked") > 0, "holiday should be paid");
  assert.ok(line(s.earnings, "leave-paid") > 0, "the leave day is paid");
});

test("monthly leave accrues 1.25 days a month and waits for six months of service", () => {
  const e = emp({ start_date: "2020-01-06" });
  assert.equal(grantedDays(VL, e, 2026, "2026-06-30"), 7.5);
  const joiner = emp({ start_date: "2026-03-01" });
  assert.equal(grantedDays(VL, joiner, 2026, "2026-09-20"), 0, "eligible Sept 1; nothing earned until a full month passes");
  assert.equal(grantedDays(VL, joiner, 2026, "2026-12-31"), 5, "four full months, Sept to Dec");
  const d = db({ employee: { start_date: "2026-11-03" }, leaveTypes });
  assert.match(validateLeave(d, d.employees[0], VL, "2026-12-01", "2026-12-01", false, "2026-11-27").type ?? "", /6 months/);
});

test("statutory leave is a full yearly entitlement once eligible; SIL is replaced by a vacation leave of 5+ days", () => {
  const solo = STATUTORY_LEAVES.find((t) => t.id === "lt-solo")!;
  assert.equal(grantedDays(solo, emp({ start_date: "2026-01-05" }), 2026, "2026-08-01"), 7);
  const d = db({ leaveTypes });
  assert.ok(!leaveTypesFor(d).some((t) => t.id === "lt-sil"));
  assert.ok(leaveTypesFor(db({ leaveTypes: STATUTORY_LEAVES })).some((t) => t.id === "lt-sil"));
});

test("leave can only use credits earned by its first day", () => {
  const d = db({ employee: { start_date: "2020-01-06" }, leaveTypes });
  const e = d.employees[0];
  assert.equal(leaveBalance(d, e, VL, 2026, "2026-02-28").granted, 2.5);
  assert.ok(validateLeave(d, e, VL, "2026-03-02", "2026-03-13", false, "2026-02-20").type, "10 days in early March is more than 2.5 + 5 carried");
  assert.deepEqual(validateLeave(d, e, VL, "2026-03-02", "2026-03-06", false, "2026-02-20"), {});
});

test("probation: no written standards, or past 180 days, means regular", () => {
  const base = { employment_status_ph: "probationary" as const, start_date: "2026-01-05" };
  assert.equal(legalStatus(emp({ ...base, standards_given_on: null }), "2026-03-01").status, "regular");
  assert.equal(legalStatus(emp({ ...base, standards_given_on: "2026-01-05" }), "2026-03-01").status, "probationary");
  assert.equal(legalStatus(emp({ ...base, standards_given_on: "2026-01-05", probation_end_date: probationEndFor("2026-01-05") }), "2026-07-10").status, "regular");
  assert.equal(legalStatus(emp({ employment_status_ph: "casual", start_date: "2025-01-05" }), "2026-01-06").status, "regular");
});

test("service years: six months or more counts as a whole year", () => {
  assert.equal(creditedYears("2020-01-01", "2024-07-01"), 5);
  assert.equal(creditedYears("2020-01-01", "2024-06-30"), 4);
});

test("separation pay follows Art. 298–299", () => {
  const d = db({ employee: { start_date: "2023-01-02" } });
  const e = d.employees[0];
  near(separationPay(d, e, "2026-01-30", "redundancy").amount, 3 * 30000); // 3 years × 1 month
  near(separationPay(d, e, "2026-01-30", "retrenchment").amount, 1.5 * 30000); // 3 × ½ month
  near(separationPay(d, { ...e, start_date: "2025-01-06" }, "2026-01-30", "retrenchment").amount, 30000); // floor of one month
  assert.equal(separationPay(d, e, "2026-01-30", "closure_losses").amount, 0);
  assert.equal(separationPay(d, e, "2026-01-30", "resignation").amount, 0);
});

test("retirement pay is 22.5 days a year at 60 with 5 years (RA 7641)", () => {
  const d = db({ employee: { start_date: "2016-01-04", birth_date: "1965-05-01" } });
  const r = retirementPay(d, d.employees[0], "2026-06-30");
  assert.ok(r.eligible);
  near(r.amount, 22.5 * DAILY * 10);
  assert.ok(!retirementPay(d, { ...d.employees[0], birth_date: "1970-01-01" }, "2026-06-30").eligible);
});

test("annual tax table, 2023 onward", () => {
  assert.equal(annualTax(250000), 0);
  assert.equal(annualTax(400000), 22500);
  assert.equal(annualTax(800000), 102500);
  assert.equal(annualTax(1000000), 152500);
  assert.equal(annualTax(2500000), 552500);
});

test("the last payroll of the year annualizes and can refund", () => {
  // Joined Dec 1: two cutoffs of ₱15,000 a year is far below ₱250,000, so whatever was withheld comes back.
  const d = db({ employee: { start_date: "2026-12-01" }, records: present("2026-12-01", "2026-12-31") });
  const first = computePayslip(d, d.employees[0], P("2026-12-01"), NOW)!;
  const last = slip(d, "2026-12-16");
  near(last.tax, -first.tax);
  assert.ok(last.flags.some((f) => f.includes("refund")));
});

test("annualization uses the year-to-date imported at go-live", () => {
  const opening: PayrollOpening = { employee_id: "e1", year: 2026, through_date: "2026-11-30", taxable_compensation: 300000, tax_withheld: 0, non_taxable_benefits: 0, mandatory_contributions: 0, basic_pay: 330000, thirteenth_paid: 0 };
  const d = db({ records: present("2026-12-01", "2026-12-31"), openings: [opening] });
  const dec1 = computePayslip(d, d.employees[0], P("2026-12-01"), NOW)!;
  const last = slip(d, "2026-12-16");
  near(last.tax, annualTax(300000 + dec1.taxable + last.taxable) - dec1.tax);
});

test("unused vacation leave is paid in cash in December: 12 days tax-free, carry-over kept", () => {
  const d = db({ employee: { start_date: "2020-01-06" }, records: present("2026-12-16", "2026-12-31"), leaveTypes });
  const s = slip(d, "2026-12-16");
  const cash = line(s.additions, "leave-cash-lt-vl");
  near(cash, 15 * DAILY, "20 available (15 + 5 carried), 5 kept"); // 15 days paid
});

test("regional minimum wage follows the work location", () => {
  const d = db({ employee: { location_id: "loc-ceb" }, comp: { rate: 12000 } });
  d.locations = [{ id: "loc-ceb", organization_id: "o", name: "Cebu", city: "Cebu", country_code: "PH", timezone: TZ, is_remote: false, ph_region: "VII" }];
  const s = slip(d, B0);
  assert.equal(s.minimumWage.daily, 582);
  assert.ok(s.belowMinimum, "₱12,000 a month is ₱551.72 a day, under ₱582");
});

test("final pay: pro-rated 13th month, leave cash, and only authorized loan balances deducted", () => {
  const items = [
    payItem({ direction: "deduction", category: "company_loan", label: "Laptop loan", amount: 1000, start_date: "2026-10-01", installments: 10, authorization: "signed" }),
    payItem({ direction: "deduction", category: "company_loan", label: "Advance", amount: 500, start_date: "2026-10-01", installments: 10 }),
  ];
  const d = db({ employee: { start_date: "2024-01-08" }, records: present("2026-11-16", "2026-11-30"), items, leaveTypes });
  const fp = finalPay(d, d.employees[0], "2026-11-30", "resignation", NOW, "2026-10-30");
  near(fp.lines.find((l) => l.key === "13th")!.amount, 30000 * (334 / (365 / 12)) / 12);
  assert.ok(fp.lines.some((l) => l.key === "leave-lt-vl"));
  assert.equal(fp.deductions.length, 1);
  near(fp.deductions[0].amount, 1000 * (10 - 4)); // 4 cutoffs paid Oct 1 – Nov 30
  assert.ok(fp.checks.some((c) => !c.ok && c.text.includes("Advance")));
  assert.ok(fp.checks.some((c) => c.ok && c.text.includes("31 days")));
});
