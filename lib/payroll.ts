// Philippine payroll rules for the prototype. Every rate below cites its legal source; see docs/payroll-rules.md.
// Pay follows the employee's shift code: only time inside the schedule is paid, plus overtime that was filed and approved.

import type { Compensation, Database, Employee, Holiday, OvertimeRequest, PayrollPeriod, ShiftCode, TimeRecord } from "./types";
import { addDays } from "./format";
import { isWeekend, localToIso, spanMinutes, zoned } from "./time";

export const RULES = {
  minimumWage: { region: "NCR", daily: 755, effective: "2026-09-26", source: "Wage Order No. NCR-28" },
  workdaysPerYear: 261, // 5-day week, monthly-paid: daily rate = monthly × 12 ÷ 261
  overtime: 1.25, // Labor Code Art. 87
  restDay: 1.3, // Art. 93
  specialDay: 1.3, // Art. 93(c); DOLE Labor Advisory 12-25
  specialOnRestDay: 1.5,
  regularHoliday: 2.0, // Art. 94
  regularOnRestDay: 2.6,
  otOnPremiumDay: 1.3, // OT on rest/holiday: +30% of that day's hourly rate
  nightDifferential: 0.1, // Art. 86: 10% for work between 10 PM and 6 AM
  nightStart: 22 * 60,
  nightEnd: 6 * 60,
  // RA 11199 (SSS): 15% of the monthly salary credit; employee 5%, employer 10%. MSC ₱5,000–₱35,000 in ₱500 steps.
  sss: { employee: 0.05, employer: 0.1, mscMin: 5000, mscMax: 35000, step: 500, ecLow: 10, ecHigh: 30 },
  // RA 11223 (UHC Act): 5% of basic salary, floor ₱10,000, ceiling ₱100,000, shared equally.
  philhealth: { rate: 0.05, floor: 10000, ceiling: 100000 },
  // RA 9679, HDMF Circular 460: 2% each on up to ₱10,000 (1% employee share at ₱1,500 and below).
  pagibig: { rate: 0.02, lowRate: 0.01, lowLimit: 1500, maxFundSalary: 10000 },
  // NIRC as amended by TRAIN (RA 10963), RR 11-2018 Annex E: semi-monthly table effective 2023 onward.
  taxSemiMonthly: [
    { over: 0, fixed: 0, rate: 0 },
    { over: 10417, fixed: 0, rate: 0.15 },
    { over: 16667, fixed: 937.5, rate: 0.2 },
    { over: 33333, fixed: 4270.7, rate: 0.25 },
    { over: 83333, fixed: 16770.7, rate: 0.3 },
    { over: 333333, fixed: 91770.7, rate: 0.35 },
  ],
  thirteenthMonthDue: "12-24", // PD 851
  thirteenthMonthTaxFree: 90000, // RA 10963
} as const;

export const SOURCES: Record<string, { label: string; url: string }> = {
  laborCode: { label: "Labor Code of the Philippines (PD 442), Book III", url: "https://lawphil.net/statutes/presdecs/pd1974/pd_442_1974.html" },
  holidays2026: { label: "Proclamation No. 1006 (2026 holidays)", url: "https://lawphil.net/executive/proc/proc2025/proc_1006_2025.html" },
  holidayPay: { label: "DOLE Labor Advisory No. 12, s. 2025 (2026 holiday pay rules)", url: "https://www.grantthornton.com.ph/technical-alerts/outsourcing-alert/2025/dole-labor-advisory-no-12-25/" },
  wage: { label: "Wage Order No. NCR-28 (₱755 from Sept 26, 2026)", url: "https://laborcode.ph/755-minimum-wage-ncr-27/" },
  sss: { label: "RA 11199 and the 2025–2026 SSS contribution schedule", url: "https://sweldoph.com/guides/sss-contribution" },
  philhealth: { label: "RA 11223, PhilHealth 5% premium", url: "https://taxcalculator.com.ph/guides/philhealth-contribution-table-2026" },
  pagibig: { label: "RA 9679, HDMF Circular 460 (₱10,000 fund salary cap)", url: "https://sweldoph.com/guides/pagibig-contribution" },
  tax: { label: "RR 11-2018 withholding tax table, 2023 onward", url: "https://www.pesohub.ph/government/bir/withholding-tax-table-philippines/" },
};

// ---- Periods ------------------------------------------------------------------
// Semi-monthly: 1–15 paid on the 20th, 16–end paid on the 5th. Art. 103: at least twice a month, ≤16 days apart.

export function periodFor(date: string): Omit<PayrollPeriod, "status" | "finalized_at" | "finalized_by"> {
  const [y, m, d] = date.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  if (d <= 15) return { id: `pp-${y}-${mm}-a`, start_date: `${y}-${mm}-01`, end_date: `${y}-${mm}-15`, pay_date: `${y}-${mm}-20` };
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m, 5)).toISOString().slice(0, 10);
  return { id: `pp-${y}-${mm}-b`, start_date: `${y}-${mm}-16`, end_date: `${y}-${mm}-${last}`, pay_date: next };
}

export function datesIn(p: { start_date: string; end_date: string }): string[] {
  const out: string[] = [];
  for (let d = p.start_date; d <= p.end_date; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---- Rates --------------------------------------------------------------------

export function rates(c: Compensation, shift: ShiftCode | undefined) {
  const paidMin = shift ? spanMinutes(shift) - shift.break_minutes : 480;
  if (c.pay_basis === "monthly") {
    const daily = (c.rate * 12) / RULES.workdaysPerYear;
    return { monthly: c.rate, daily, hourly: daily / 8, scheduledDaily: daily * (paidMin / 480) };
  }
  const hourly = c.rate;
  return { monthly: (hourly * (paidMin / 60) * RULES.workdaysPerYear) / 12, daily: hourly * 8, hourly, scheduledDaily: hourly * (paidMin / 60) };
}

export function isMinimumWageEarner(c: Compensation, shift: ShiftCode | undefined) {
  return rates(c, shift).daily <= RULES.minimumWage.daily;
}

export function belowMinimumWage(c: Compensation, shift: ShiftCode | undefined) {
  return rates(c, shift).daily < RULES.minimumWage.daily;
}

// ---- Contributions and tax -------------------------------------------------------

export function sssMsc(monthlyComp: number) {
  const { mscMin, mscMax, step } = RULES.sss;
  return Math.min(mscMax, Math.max(mscMin, mscMin + step * Math.floor((monthlyComp - (mscMin - step / 2)) / step)));
}

export function monthlyContributions(monthlyBasic: number) {
  const msc = sssMsc(monthlyBasic);
  const ph = RULES.philhealth.rate * Math.min(RULES.philhealth.ceiling, Math.max(RULES.philhealth.floor, monthlyBasic));
  const pagBase = Math.min(RULES.pagibig.maxFundSalary, monthlyBasic);
  return {
    msc,
    sssEe: msc * RULES.sss.employee,
    sssEr: msc * RULES.sss.employer + (msc < 15000 ? RULES.sss.ecLow : RULES.sss.ecHigh),
    phEe: ph / 2,
    phEr: ph / 2,
    pagEe: pagBase * (monthlyBasic <= RULES.pagibig.lowLimit ? RULES.pagibig.lowRate : RULES.pagibig.rate),
    pagEr: pagBase * RULES.pagibig.rate,
  };
}

export function withholdingSemiMonthly(taxable: number) {
  const row = [...RULES.taxSemiMonthly].reverse().find((r) => taxable > r.over) ?? RULES.taxSemiMonthly[0];
  return Math.max(0, row.fixed + (taxable - row.over) * row.rate);
}

// ---- Day-level attendance -----------------------------------------------------------

export type DayType = "ordinary" | "rest" | "regular" | "special" | "regular_rest" | "special_rest";

export interface DayCalc {
  date: string;
  type: DayType;
  holiday?: Holiday;
  future: boolean;
  scheduledMin: number;
  workedMin: number; // inside the schedule, net of break
  lateMin: number;
  undertimeMin: number;
  absent: boolean;
  holidayPaidUnworked: boolean;
  otMin: number; // approved and actually worked
  otFirst8Min: number; // part of rest-day/holiday work in the first 8 hours
  otMult: number;
  nsdMin: number;
  unapprovedExtraMin: number; // time recorded outside the schedule without an approved OT request (not paid)
  pendingOtMin: number;
  incomplete: boolean; // timed in but no time out: unpaid until a correction is approved
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function nightMinutes(from: number, to: number, tz: string): number {
  if (to <= from) return 0;
  let total = 0;
  // Walk each local day touched by the interval and add the 10 PM–6 AM windows.
  const startDay = zoned(from, tz).date;
  for (let d = addDays(startDay, -1); d <= zoned(to, tz).date; d = addDays(d, 1)) {
    const w0 = Date.parse(localToIso(d, "22:00", tz));
    const w1 = Date.parse(localToIso(addDays(d, 1), "06:00", tz));
    total += overlap(from, to, w0, w1);
  }
  return Math.round(total / 60000);
}

export function effectiveInOut(records: TimeRecord[]) {
  const pick = (kind: TimeRecord["kind"], last: boolean) => {
    const corr = records.filter((r) => r.kind === kind && r.source === "correction").sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
    if (corr) return corr;
    const dev = records.filter((r) => r.kind === kind && r.source === "device").sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
    return last ? dev[dev.length - 1] : dev[0];
  };
  return { clockIn: pick("clock_in", false), clockOut: pick("clock_out", true) };
}

export function computeDay(
  date: string,
  shift: ShiftCode | undefined,
  records: TimeRecord[],
  approvedOt: OvertimeRequest[],
  pendingOt: OvertimeRequest[],
  holiday: Holiday | undefined,
  prevWorkdayPresent: boolean,
  nowMs: number,
  managerial: boolean,
): DayCalc {
  const tz = shift?.timezone ?? "Asia/Manila";
  const rest = isWeekend(date);
  const hk = holiday && holiday.kind !== "special_working" ? holiday.kind : null;
  const type: DayType = hk === "regular" ? (rest ? "regular_rest" : "regular") : hk === "special_non_working" ? (rest ? "special_rest" : "special") : rest ? "rest" : "ordinary";
  const { clockIn, clockOut } = effectiveInOut(records);
  const inMs = clockIn ? Date.parse(clockIn.recorded_at) : null;
  const outMs = clockOut ? Date.parse(clockOut.recorded_at) : null;

  const base: DayCalc = {
    date, type, holiday, future: false, scheduledMin: 0, workedMin: 0, lateMin: 0, undertimeMin: 0, absent: false,
    holidayPaidUnworked: false, otMin: 0, otFirst8Min: 0, otMult: 1, nsdMin: 0, unapprovedExtraMin: 0, pendingOtMin: 0, incomplete: false,
  };

  let schedStart = 0, schedEnd = 0;
  if (shift && !rest) {
    schedStart = Date.parse(localToIso(date, shift.start_time, tz));
    schedEnd = schedStart + spanMinutes(shift) * 60000;
    base.scheduledMin = spanMinutes(shift) - shift.break_minutes;
    base.future = nowMs < schedEnd; // today's shift still running, or a later day: projected in a draft
  }

  // Worked time counts only inside the schedule (net of the unpaid break).
  if (shift && !rest && inMs && outMs) {
    const inside = overlap(inMs, outMs, schedStart, schedEnd) / 60000;
    base.workedMin = Math.round(Math.min(base.scheduledMin, Math.max(0, inside - (inside > 300 ? shift.break_minutes : 0))));
    base.lateMin = Math.max(0, Math.round((inMs - schedStart) / 60000) > shift.grace_minutes ? Math.round((inMs - schedStart) / 60000) : 0);
    base.undertimeMin = Math.max(0, Math.round((schedEnd - outMs) / 60000));
    if (!managerial) base.nsdMin = Math.max(0, nightMinutes(Math.max(inMs, schedStart), Math.min(outMs, schedEnd), tz) - (shift.start_time >= "18:00" ? shift.break_minutes : 0));
  } else if (shift && !rest && !base.future && inMs && !outMs) {
    const late = Math.round((inMs - schedStart) / 60000);
    base.lateMin = late > shift.grace_minutes ? late : 0;
    base.undertimeMin = Math.max(0, base.scheduledMin - base.lateMin);
    base.incomplete = true;
  } else if (shift && !rest && !base.future && !inMs) {
    if (hk === "regular") base.holidayPaidUnworked = prevWorkdayPresent; // Art. 94 + IRR Book III Rule IV §6
    else if (hk !== "special_non_working") base.absent = true;
  }

  // Overtime: only approved requests, and only the minutes the time records show were worked (Art. 87).
  if (inMs && outMs && !managerial) {
    for (const r of approvedOt) {
      const m = Math.round(overlap(inMs, outMs, Date.parse(r.start_at), Date.parse(r.end_at)) / 60000);
      base.otMin += Math.max(0, m - (shift && !rest ? Math.round(overlap(Date.parse(r.start_at), Date.parse(r.end_at), schedStart, schedEnd) / 60000) : 0));
      base.nsdMin += nightMinutes(Math.max(inMs, Date.parse(r.start_at)), Math.min(outMs, Date.parse(r.end_at)), tz);
    }
    const outside = Math.round(((outMs - inMs) - (shift && !rest ? overlap(inMs, outMs, schedStart, schedEnd) : 0)) / 60000);
    for (const r of pendingOt) base.pendingOtMin += Math.round(overlap(inMs, outMs, Date.parse(r.start_at), Date.parse(r.end_at)) / 60000);
    const extra = Math.max(0, outside - base.otMin - base.pendingOtMin - (inMs < schedStart ? Math.round((schedStart - inMs) / 60000) : 0));
    base.unapprovedExtraMin = extra >= 30 ? extra : 0; // a few minutes past the end of a shift isn't overtime
  }

  // Rest days and holidays: the first 8 hours carry the day premium; minutes past 8 get +30% on top (Art. 87, 93, 94).
  if (type !== "ordinary" && (rest || !shift)) base.otFirst8Min = Math.min(480, base.otMin);
  base.otMult = { ordinary: RULES.overtime, rest: RULES.restDay, special: RULES.specialDay, special_rest: RULES.specialOnRestDay, regular: RULES.regularHoliday, regular_rest: RULES.regularOnRestDay }[type];
  return base;
}

// ---- Payslip ---------------------------------------------------------------------

export interface PayLine { key: string; label: string; detail?: string; amount: number }

export interface Payslip {
  employee: Employee;
  comp: Compensation;
  shift: ShiftCode | undefined;
  period: PayrollPeriod;
  days: DayCalc[];
  earnings: PayLine[];
  deductions: PayLine[];
  contributions: PayLine[];
  employer: PayLine[];
  gross: number;
  taxable: number;
  tax: number;
  net: number;
  mwe: boolean;
  flags: string[];
  pendingRequests: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const hrs = (m: number) => `${(m / 60).toFixed(2).replace(/\.00$/, "")} h`;

export function computePayslip(db: Database, employee: Employee, period: PayrollPeriod, nowIso: string): Payslip | null {
  const comp = db.compensation.find((c) => c.employee_id === employee.id && c.on_ph_payroll);
  if (!comp || employee.start_date > period.end_date || (employee.end_date && employee.end_date < period.start_date)) return null;
  const shift = db.shift_codes.find((s) => s.id === employee.shift_code_id);
  const rt = rates(comp, shift);
  const nowMs = Date.parse(nowIso);
  const flags: string[] = [];
  const mwe = isMinimumWageEarner(comp, shift);
  if (belowMinimumWage(comp, shift)) flags.push(`Daily rate ₱${rt.daily.toFixed(2)} is below the ₱${RULES.minimumWage.daily} NCR minimum (${RULES.minimumWage.source}).`);
  if (!shift) flags.push("No shift code, so no scheduled time can be paid. Assign one before finalizing.");

  const recs = db.time_records.filter((r) => r.employee_id === employee.id);
  const ot = db.overtime_requests.filter((r) => r.employee_id === employee.id);
  const days: DayCalc[] = [];
  let prevPresent = true;
  for (const d of datesIn(period)) {
    if (d < employee.start_date || (employee.end_date && d > employee.end_date)) continue;
    const dayRecs = recs.filter((r) => r.work_date === d);
    const day = computeDay(
      d, shift, dayRecs,
      ot.filter((r) => r.work_date === d && r.status === "approved"),
      ot.filter((r) => r.work_date === d && r.status === "pending"),
      db.holidays.find((h) => h.date === d), prevPresent, nowMs, comp.is_managerial,
    );
    days.push(day);
    if (day.type === "ordinary") prevPresent = dayRecs.some((r) => r.kind === "clock_in");
  }

  const earnings: PayLine[] = [];
  const deductions: PayLine[] = [];
  const minRate = rt.hourly / 60;
  const premium = !comp.is_managerial;

  if (comp.pay_basis === "monthly") {
    // Joiners and leavers mid-period are paid for the workdays they were employed.
    const all = datesIn(period).filter((d) => !isWeekend(d));
    const employed = all.filter((d) => d >= employee.start_date && (!employee.end_date || d <= employee.end_date));
    const share = all.length ? employed.length / all.length : 1;
    earnings.push({
      key: "basic", label: "Basic pay",
      detail: share < 1 ? `${employed.length} of ${all.length} workdays of ₱${(rt.monthly / 2).toLocaleString("en-PH")} (joined ${employee.start_date})` : `Half of ₱${rt.monthly.toLocaleString("en-PH")} monthly`,
      amount: (rt.monthly / 2) * share,
    });
    const late = days.reduce((n, d) => n + d.lateMin, 0);
    const under = days.reduce((n, d) => n + d.undertimeMin, 0);
    const absentDays = days.filter((d) => d.absent);
    const holidayUnpaid = days.filter((d) => d.type === "regular" && !d.holidayPaidUnworked && !d.future && d.workedMin === 0 && shift);
    if (late) deductions.push({ key: "late", label: "Late", detail: hrs(late), amount: late * minRate });
    if (under) deductions.push({ key: "undertime", label: "Undertime", detail: `${hrs(under)} · can’t be offset by overtime (Art. 88)`, amount: under * minRate });
    if (absentDays.length) deductions.push({ key: "absent", label: "Absences", detail: `${absentDays.length} day${absentDays.length > 1 ? "s" : ""} · no work, no pay`, amount: absentDays.reduce((n, d) => n + d.scheduledMin, 0) * minRate });
    if (holidayUnpaid.length) deductions.push({ key: "holiday-ineligible", label: "Unpaid regular holiday", detail: "Absent on the workday before (IRR Book III, Rule IV §6)", amount: holidayUnpaid.length * rt.scheduledDaily });
  } else {
    const worked = days.filter((d) => d.type === "ordinary").reduce((n, d) => n + d.workedMin, 0);
    earnings.push({ key: "basic", label: "Basic pay", detail: `${hrs(worked)} × ₱${rt.hourly.toFixed(2)}`, amount: worked * minRate });
    const hol = days.filter((d) => d.holidayPaidUnworked);
    if (hol.length) earnings.push({ key: "holiday-unworked", label: "Regular holiday pay (not worked)", detail: `${hol.length} day · 100% (Art. 94)`, amount: hol.reduce((n, d) => n + d.scheduledMin, 0) * minRate });
    const special = days.filter((d) => d.type === "special" || d.type === "regular");
    const sw = special.reduce((n, d) => n + d.workedMin, 0);
    if (sw) earnings.push({ key: "holiday-base", label: "Holiday hours worked", detail: hrs(sw), amount: sw * minRate });
  }

  if (premium) {
    const reg = days.filter((d) => d.type === "regular").reduce((n, d) => n + d.workedMin, 0);
    const spc = days.filter((d) => d.type === "special").reduce((n, d) => n + d.workedMin, 0);
    if (reg) earnings.push({ key: "reg-premium", label: "Regular holiday premium", detail: `${hrs(reg)} at +100% (Art. 94)`, amount: reg * minRate * (RULES.regularHoliday - 1) });
    if (spc) earnings.push({ key: "spc-premium", label: "Special day premium", detail: `${hrs(spc)} at +30%`, amount: spc * minRate * (RULES.specialDay - 1) });
  }

  // Overtime, grouped by multiplier.
  const otGroups = new Map<string, { min: number; mult: number }>();
  for (const d of days) {
    if (!d.otMin) continue;
    if (d.type === "ordinary") add(`Overtime, regular day · ${pct(RULES.overtime)}`, d.otMin, RULES.overtime);
    else if (d.otFirst8Min) {
      add(`${dayLabel(d.type)} work, first 8 h · ${pct(d.otMult)}`, d.otFirst8Min, d.otMult);
      if (d.otMin > d.otFirst8Min) add(`${dayLabel(d.type)} overtime · ${pct(d.otMult * RULES.otOnPremiumDay)}`, d.otMin - d.otFirst8Min, d.otMult * RULES.otOnPremiumDay);
    } else add(`${dayLabel(d.type)} overtime · ${pct(d.otMult * RULES.otOnPremiumDay)}`, d.otMin, d.otMult * RULES.otOnPremiumDay);
  }
  function add(label: string, min: number, mult: number) {
    const g = otGroups.get(label) ?? { min: 0, mult };
    g.min += min;
    otGroups.set(label, g);
  }
  for (const [label, g] of otGroups) earnings.push({ key: `ot-${label}`, label, detail: `${hrs(g.min)} approved`, amount: g.min * minRate * g.mult });

  const nsd = days.reduce((n, d) => n + d.nsdMin, 0);
  if (nsd && premium) earnings.push({ key: "nsd", label: "Night shift differential", detail: `${hrs(nsd)} between 10 PM and 6 AM at +10% (Art. 86)`, amount: nsd * minRate * RULES.nightDifferential });

  const unapproved = days.reduce((n, d) => n + d.unapprovedExtraMin, 0);
  const incomplete = days.filter((d) => d.incomplete).length;
  if (incomplete) flags.push(`${incomplete} day${incomplete > 1 ? "s" : ""} with a time in but no time out. Unpaid until a time correction is approved.`);
  if (unapproved && !comp.is_managerial) flags.push(`${hrs(unapproved)} recorded outside the schedule without approved overtime. Not paid unless an overtime request is filed and approved.`);

  const gross = earnings.reduce((n, l) => n + l.amount, 0) - deductions.reduce((n, l) => n + l.amount, 0);
  const mc = monthlyContributions(rt.monthly);
  const contributions: PayLine[] = [
    { key: "sss", label: "SSS", detail: `5% of ₱${mc.msc.toLocaleString("en-PH")} salary credit, half this cutoff`, amount: mc.sssEe / 2 },
    { key: "philhealth", label: "PhilHealth", detail: "2.5% employee share, half this cutoff", amount: mc.phEe / 2 },
    { key: "pagibig", label: "Pag-IBIG", detail: "2% up to ₱10,000, half this cutoff", amount: mc.pagEe / 2 },
  ];
  const employer: PayLine[] = [
    { key: "sss-er", label: "SSS (incl. EC)", amount: mc.sssEr / 2 },
    { key: "ph-er", label: "PhilHealth", amount: mc.phEr / 2 },
    { key: "pag-er", label: "Pag-IBIG", amount: mc.pagEr / 2 },
  ];
  const contribTotal = contributions.reduce((n, l) => n + l.amount, 0);
  const taxable = Math.max(0, gross - contribTotal);
  const tax = mwe ? 0 : withholdingSemiMonthly(taxable);
  const pendingRequests =
    db.overtime_requests.filter((r) => r.employee_id === employee.id && r.status === "pending" && r.work_date >= period.start_date && r.work_date <= period.end_date).length +
    db.correction_requests.filter((r) => r.employee_id === employee.id && r.status === "pending" && r.work_date >= period.start_date && r.work_date <= period.end_date).length;
  if (pendingRequests) flags.push(`${pendingRequests} request${pendingRequests > 1 ? "s" : ""} still waiting for approval in this period.`);

  return {
    employee, comp, shift, period, days,
    earnings: earnings.map((l) => ({ ...l, amount: r2(l.amount) })),
    deductions: deductions.map((l) => ({ ...l, amount: r2(l.amount) })),
    contributions: contributions.map((l) => ({ ...l, amount: r2(l.amount) })),
    employer: employer.map((l) => ({ ...l, amount: r2(l.amount) })),
    gross: r2(gross), taxable: r2(taxable), tax: r2(tax), net: r2(gross - contribTotal - tax), mwe, flags, pendingRequests,
  };
}

function pct(m: number) { return `${Math.round(m * 1000) / 10}%`; }
function dayLabel(t: DayType) {
  return { ordinary: "Regular day", rest: "Rest day", special: "Special day", special_rest: "Special day on rest day", regular: "Regular holiday", regular_rest: "Regular holiday on rest day" }[t];
}

export const peso = (n: number) => `${n < 0 ? "−" : ""}₱${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function thirteenthMonthEstimate(comp: Compensation, shift: ShiftCode | undefined, startDate: string, year: number) {
  const from = startDate > `${year}-01-01` ? startDate : `${year}-01-01`;
  const months = Math.max(0, (Date.parse(`${year}-12-31`) - Date.parse(from)) / (86400000 * 30.44));
  return (rates(comp, shift).monthly * Math.min(12, months)) / 12;
}
