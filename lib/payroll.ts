// Philippine payroll rules for the prototype. Every rate below cites its legal source; see docs/payroll-rules.md.
// Pay follows the employee's shift code: only time inside the schedule is paid, plus overtime that was filed and approved.

import type { Compensation, Database, DeMinimisKind, DeductionCategory, Employee, EmployeePayrollSettings, Holiday, OvertimeRequest, PayItem, PayrollPeriod, PayrollSettings, ShiftCode, TimeRecord } from "./types";
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
  thirteenthMonthTaxFree: 90000, // RA 10963: 13th month and other benefits, combined, per year
  // RR 29-2025 (issued Dec 22, 2025): de minimis ceilings. Excess counts toward the ₱90,000 pool.
  deMinimis: {
    rice: { cap: 2500, per: "month", label: "Rice subsidy" },
    laundry: { cap: 400, per: "month", label: "Laundry allowance" },
    medical_dependents: { cap: 2000, per: "semester", label: "Medical cash allowance to dependents" },
    uniform: { cap: 8000, per: "year", label: "Uniform and clothing allowance" },
    medical_assistance: { cap: 12000, per: "year", label: "Actual medical assistance" },
    achievement_award: { cap: 12000, per: "year", label: "Employee achievement award" },
    christmas_gift: { cap: 6000, per: "year", label: "Christmas or anniversary gift" },
    cba_incentive: { cap: 12000, per: "year", label: "CBA and productivity incentives" },
    ot_meal: { cap: 0, per: "ot_day", label: "Overtime or night-shift meal allowance" }, // 30% of the basic daily wage per day
  } as Record<DeMinimisKind, { cap: number; per: "month" | "semester" | "year" | "ot_day"; label: string }>,
  otMealShareOfDaily: 0.3,
  lossDamageMaxShare: 0.2, // Art. 114–115, IRR Book III Rule VIII §14: ≤ 20% of the employee's wages in a week
} as const;

export const DEFAULT_SETTINGS: PayrollSettings = {
  workdays_per_year: 261,
  minimum_wage_daily: 755,
  minimum_wage_label: "NCR, Wage Order No. NCR-28",
  contribution_timing: "split",
  sss_basis: "actual_compensation",
  employer_pays_sss: false,
  employer_pays_philhealth: false,
  employer_pays_pagibig: false,
  pay_unworked_special_days: true,
  deduct_managerial_tardiness: false,
  thirteenth_month_for_managerial: true,
};

// Deductions the law allows without a separate signed authorization (Art. 113: authorized by law).
export const NO_AUTH_NEEDED: DeductionCategory[] = ["sss_loan", "pagibig_loan"];
// Order in which non-statutory deductions are taken when pay can't cover them all. The rest carries over.
export const DEDUCTION_PRIORITY: DeductionCategory[] = ["sss_loan", "pagibig_loan", "union_dues", "insurance", "company_loan", "other_authorized", "loss_damage"];

export const SOURCES: Record<string, { label: string; url: string }> = {
  laborCode: { label: "Labor Code of the Philippines (PD 442), Book III", url: "https://lawphil.net/statutes/presdecs/pd1974/pd_442_1974.html" },
  holidays2026: { label: "Proclamation No. 1006 (2026 holidays)", url: "https://lawphil.net/executive/proc/proc2025/proc_1006_2025.html" },
  holidayPay: { label: "DOLE Labor Advisory No. 12, s. 2025 (2026 holiday pay rules)", url: "https://www.grantthornton.com.ph/technical-alerts/outsourcing-alert/2025/dole-labor-advisory-no-12-25/" },
  wage: { label: "Wage Order No. NCR-28 (₱755 from Sept 26, 2026)", url: "https://laborcode.ph/755-minimum-wage-ncr-27/" },
  sss: { label: "RA 11199 and the 2025–2026 SSS contribution schedule", url: "https://sweldoph.com/guides/sss-contribution" },
  philhealth: { label: "RA 11223, PhilHealth 5% premium", url: "https://taxcalculator.com.ph/guides/philhealth-contribution-table-2026" },
  pagibig: { label: "RA 9679, HDMF Circular 460 (₱10,000 fund salary cap)", url: "https://sweldoph.com/guides/pagibig-contribution" },
  tax: { label: "RR 11-2018 withholding tax table, 2023 onward", url: "https://www.pesohub.ph/government/bir/withholding-tax-table-philippines/" },
  deMinimis: { label: "RR 29-2025, new de minimis ceilings (PwC tax alert)", url: "https://www.pwc.com/ph/en/tax/tax-publications/tax-alerts/2026/tax-alert-02.html" },
  taxExclusions: { label: "NIRC Sec. 32(B)(7): mandatory employee contributions and union dues excluded", url: "https://www.lawyer-philippines.com/articles/tax-deductibility-of-employee-shares-or-contributions-in-computing-taxable-compensation" },
  deductions: { label: "Labor Code Arts. 113–116 and DO 195-18 on wage deductions", url: "https://www.respicio.ph/commentaries/salary-deductions-in-the-philippines-dole-rules-employers-must-follow" },
  successiveHolidays: { label: "Successive regular holidays (Art. 94 and its IRR)", url: "https://ndvlaw.com/how-is-holiday-pay-legally-handled-when-there-are-two-successive-regular-holidays/" },
  crossMidnight: { label: "Shifts that cross midnight into a holiday", url: "https://www.respicio.ph/commentaries/holiday-pay-for-work-shifts-that-cross-midnight-into-a-regular-holiday" },
  sssCompensation: { label: "What counts as compensation for SSS", url: "https://www.respicio.ph/commentaries/inclusion-of-overtime-and-premium-pay-in-sss-monthly-salary-credit" },
  thirteenth: { label: "DOLE guidelines on 13th month pay (Grant Thornton)", url: "https://www.grantthornton.com.ph/technical-alerts/outsourcing-alert/2025/guidelines-on-the-payment-of-13th-month-pay/" },
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


const firstHalfOf = (p: { start_date: string }) => p.start_date.endsWith("-16");
const isSecondCutoff = firstHalfOf;
export function firstCutoffOfMonth(p: { start_date: string }): PayrollPeriod {
  return { ...periodFor(p.start_date.slice(0, 8) + "01"), status: "open", finalized_at: null, finalized_by: null };
}

// ---- Rates --------------------------------------------------------------------

export function rates(c: Compensation, shift: ShiftCode | undefined, settings: PayrollSettings = DEFAULT_SETTINGS) {
  const paidMin = shift ? spanMinutes(shift) - shift.break_minutes : 480;
  const factor = settings.workdays_per_year;
  if (c.pay_basis === "monthly") {
    const daily = (c.rate * 12) / factor;
    return { monthly: c.rate, daily, hourly: daily / 8, scheduledDaily: daily * (paidMin / 480) };
  }
  const hourly = c.rate;
  return { monthly: (hourly * (paidMin / 60) * factor) / 12, daily: hourly * 8, hourly, scheduledDaily: hourly * (paidMin / 60) };
}

export function isMinimumWageEarner(c: Compensation, shift: ShiftCode | undefined, settings: PayrollSettings = DEFAULT_SETTINGS) {
  return rates(c, shift, settings).daily <= settings.minimum_wage_daily;
}

export function belowMinimumWage(c: Compensation, shift: ShiftCode | undefined, settings: PayrollSettings = DEFAULT_SETTINGS) {
  return rates(c, shift, settings).daily < settings.minimum_wage_daily - 0.005;
}

// ---- Contributions and tax -------------------------------------------------------

export function sssMsc(monthlyComp: number) {
  const { mscMin, mscMax, step } = RULES.sss;
  return Math.min(mscMax, Math.max(mscMin, mscMin + step * Math.floor((monthlyComp - (mscMin - step / 2)) / step)));
}

/** One month's contributions. SSS and Pag-IBIG use monthly compensation; PhilHealth uses monthly basic salary. */
export function monthlyContributions(sssBasis: number, philhealthBasis: number = sssBasis, pagibigBasis: number = sssBasis) {
  if (sssBasis <= 0 && philhealthBasis <= 0) return { msc: 0, sssEe: 0, sssEr: 0, phEe: 0, phEr: 0, pagEe: 0, pagEr: 0 };
  const msc = sssMsc(sssBasis);
  const ph = RULES.philhealth.rate * Math.min(RULES.philhealth.ceiling, Math.max(RULES.philhealth.floor, philhealthBasis));
  const pagBase = Math.min(RULES.pagibig.maxFundSalary, Math.max(0, pagibigBasis));
  return {
    msc,
    sssEe: msc * RULES.sss.employee,
    sssEr: msc * RULES.sss.employer + (msc < 15000 ? RULES.sss.ecLow : RULES.sss.ecHigh),
    phEe: ph / 2,
    phEr: ph / 2,
    pagEe: pagBase * (pagibigBasis <= RULES.pagibig.lowLimit ? RULES.pagibig.lowRate : RULES.pagibig.rate),
    pagEr: pagBase * RULES.pagibig.rate,
  };
}

export function withholdingSemiMonthly(taxable: number) {
  const row = [...RULES.taxSemiMonthly].reverse().find((r) => taxable > r.over) ?? RULES.taxSemiMonthly[0];
  return Math.max(0, row.fixed + (taxable - row.over) * row.rate);
}

// ---- Day-level attendance -----------------------------------------------------------

export type DayType = "ordinary" | "rest" | "regular" | "special" | "regular_rest" | "special_rest";

/** A stretch of paid time, classified by the calendar date it actually fell on. */
export interface Segment {
  kind: "regular" | "ot";
  dayType: DayType;
  date: string; // calendar date of this piece (differs from the work date after midnight)
  min: number;
  nightMin: number;
  mult: number; // pay multiplier for this piece (1 = plain rate)
}

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
  specialUnworked: boolean;
  otMin: number; // approved and actually worked
  nsdMin: number;
  unapprovedExtraMin: number; // time recorded outside the schedule without an approved OT request (not paid)
  pendingOtMin: number;
  incomplete: boolean; // timed in but no time out: unpaid until a correction is approved
  segments: Segment[];
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function nightMinutes(from: number, to: number, tz: string): number {
  if (to <= from) return 0;
  let total = 0;
  const startDay = zoned(from, tz).date;
  for (let d = addDays(startDay, -1); d <= zoned(to, tz).date; d = addDays(d, 1)) {
    const w0 = Date.parse(localToIso(d, "22:00", tz));
    const w1 = Date.parse(localToIso(addDays(d, 1), "06:00", tz));
    total += overlap(from, to, w0, w1);
  }
  return total / 60000;
}

/** Split [from, to) at local midnights. */
function splitByDate(from: number, to: number, tz: string): { date: string; from: number; to: number }[] {
  const out: { date: string; from: number; to: number }[] = [];
  let a = from;
  while (a < to) {
    const date = zoned(a, tz).date;
    const next = Date.parse(localToIso(addDays(date, 1), "00:00", tz));
    const b = Math.min(to, next);
    out.push({ date, from: a, to: b });
    a = b;
  }
  return out;
}

export function dayTypeOf(holiday: Holiday | undefined, rest: boolean): DayType {
  const hk = holiday && holiday.kind !== "special_working" ? holiday.kind : null;
  return hk === "regular" ? (rest ? "regular_rest" : "regular") : hk === "special_non_working" ? (rest ? "special_rest" : "special") : rest ? "rest" : "ordinary";
}

export function dayMultiplier(t: DayType): number {
  return { ordinary: 1, rest: RULES.restDay, special: RULES.specialDay, special_rest: RULES.specialOnRestDay, regular: RULES.regularHoliday, regular_rest: RULES.regularOnRestDay }[t];
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

export interface DayContext {
  holidayOn: (date: string) => Holiday | undefined;
  prevWorkdayPresent: boolean;
  nowMs: number;
  managerial: boolean;
}

export function computeDay(
  date: string,
  shift: ShiftCode | undefined,
  records: TimeRecord[],
  approvedOt: OvertimeRequest[],
  pendingOt: OvertimeRequest[],
  ctx: DayContext,
): DayCalc {
  const tz = shift?.timezone ?? "Asia/Manila";
  const rest = isWeekend(date);
  const holiday = ctx.holidayOn(date);
  const type = dayTypeOf(holiday, rest);
  const { clockIn, clockOut } = effectiveInOut(records);
  const inMs = clockIn ? Date.parse(clockIn.recorded_at) : null;
  const outMs = clockOut ? Date.parse(clockOut.recorded_at) : null;
  const premium = !ctx.managerial;

  const base: DayCalc = {
    date, type, holiday, future: false, scheduledMin: 0, workedMin: 0, lateMin: 0, undertimeMin: 0, absent: false,
    holidayPaidUnworked: false, specialUnworked: false, otMin: 0, nsdMin: 0, unapprovedExtraMin: 0, pendingOtMin: 0, incomplete: false, segments: [],
  };

  let schedStart = 0, schedEnd = 0;
  if (shift && !rest) {
    schedStart = Date.parse(localToIso(date, shift.start_time, tz));
    schedEnd = schedStart + spanMinutes(shift) * 60000;
    base.scheduledMin = spanMinutes(shift) - shift.break_minutes;
    base.future = ctx.nowMs < schedEnd; // today's shift still running, or a later day: projected in a draft
  }

  // Scheduled time: only time inside the schedule counts, net of the unpaid break.
  // Each piece takes the holiday status of the calendar date it fell on (a 10 PM shift into a holiday).
  if (shift && !rest && inMs && outMs) {
    const a = Math.max(inMs, schedStart), b = Math.min(outMs, schedEnd);
    const inside = Math.max(0, b - a) / 60000;
    const brk = inside > 300 ? shift.break_minutes : 0;
    base.workedMin = Math.round(Math.min(base.scheduledMin, Math.max(0, inside - brk)));
    const scale = inside > 0 ? base.workedMin / inside : 0;
    if (b > a) {
      for (const piece of splitByDate(a, b, tz)) {
        const t = dayTypeOf(ctx.holidayOn(piece.date), false);
        const min = ((piece.to - piece.from) / 60000) * scale;
        const night = premium ? nightMinutes(piece.from, piece.to, tz) * (shift.start_time >= "18:00" ? scale : 1) : 0;
        base.segments.push({ kind: "regular", dayType: t, date: piece.date, min, nightMin: Math.min(night, min), mult: premium ? dayMultiplier(t) : 1 });
      }
    }
    const late = Math.round((inMs - schedStart) / 60000);
    base.lateMin = late > shift.grace_minutes ? late : 0;
    base.undertimeMin = Math.max(0, Math.round((schedEnd - outMs) / 60000));
  } else if (shift && !rest && !base.future && inMs && !outMs) {
    const late = Math.round((inMs - schedStart) / 60000);
    base.lateMin = late > shift.grace_minutes ? late : 0;
    base.undertimeMin = Math.max(0, base.scheduledMin - base.lateMin);
    base.incomplete = true;
  } else if (shift && !rest && !base.future && !inMs) {
    if (type === "regular") base.holidayPaidUnworked = ctx.prevWorkdayPresent; // Art. 94; successive-holiday rule handled by the caller
    else if (type === "special") base.specialUnworked = true;
    else base.absent = true;
  }

  // Overtime: only approved requests, and only the minutes the time records show were worked (Art. 87).
  if (inMs && outMs && premium) {
    const pieces: { from: number; to: number }[] = [];
    for (const r of approvedOt) {
      const a = Math.max(inMs, Date.parse(r.start_at)), b = Math.min(outMs, Date.parse(r.end_at));
      if (b <= a) continue;
      if (shift && !rest) {
        if (a < schedStart) pieces.push({ from: a, to: Math.min(b, schedStart) });
        if (b > schedEnd) pieces.push({ from: Math.max(a, schedEnd), to: b });
      } else pieces.push({ from: a, to: b });
    }
    pieces.sort((x, y) => x.from - y.from);
    // On a rest day or holiday without a schedule, the first 8 hours carry the day premium; minutes past 8 get +30% on top.
    let unscheduledSoFar = 0;
    for (const p of pieces) {
      for (const piece of splitByDate(p.from, p.to, tz)) {
        const t = dayTypeOf(ctx.holidayOn(piece.date), rest);
        const min = (piece.to - piece.from) / 60000;
        const night = nightMinutes(piece.from, piece.to, tz);
        const dayMult = dayMultiplier(t);
        if (!shift || rest) {
          const first = Math.max(0, Math.min(min, 480 - unscheduledSoFar));
          unscheduledSoFar += min;
          if (first > 0) base.segments.push({ kind: "ot", dayType: t, date: piece.date, min: first, nightMin: night * (first / min), mult: dayMult });
          if (min - first > 0) base.segments.push({ kind: "ot", dayType: t, date: piece.date, min: min - first, nightMin: night * ((min - first) / min), mult: dayMult * RULES.otOnPremiumDay });
        } else {
          const mult = t === "ordinary" ? RULES.overtime : dayMult * RULES.otOnPremiumDay;
          base.segments.push({ kind: "ot", dayType: t, date: piece.date, min, nightMin: night, mult });
        }
      }
    }
    base.otMin = Math.round(base.segments.filter((s) => s.kind === "ot").reduce((n, s) => n + s.min, 0));
  }
  base.nsdMin = Math.round(base.segments.reduce((n, s) => n + s.nightMin, 0));

  if (inMs && outMs) {
    const outside = Math.round(((outMs - inMs) - (shift && !rest ? overlap(inMs, outMs, schedStart, schedEnd) : 0)) / 60000);
    for (const r of pendingOt) base.pendingOtMin += Math.round(overlap(inMs, outMs, Date.parse(r.start_at), Date.parse(r.end_at)) / 60000);
    const early = shift && !rest && inMs < schedStart ? Math.round((schedStart - inMs) / 60000) : 0;
    const extra = Math.max(0, outside - base.otMin - base.pendingOtMin - early);
    base.unapprovedExtraMin = extra >= 30 && premium ? extra : 0; // a few minutes past the end of a shift isn't overtime
  }
  return base;
}

// ---- Pay items: allowances, benefits, loans and other deductions -----------------------

const periodsBetween = (from: string, untilExclusive: string): PayrollPeriod[] => {
  const out: PayrollPeriod[] = [];
  for (let p = periodFor(from); p.start_date < untilExclusive; p = periodFor(addDays(p.end_date, 1))) out.push({ ...p, status: "open", finalized_at: null, finalized_by: null });
  return out;
};

function scheduleHits(item: PayItem, p: { start_date: string; end_date: string }) {
  if (item.start_date > p.end_date || (item.end_date && item.end_date < p.start_date)) return false;
  if (item.schedule === "once") return item.start_date >= p.start_date && item.start_date <= p.end_date;
  if (item.schedule === "first_cutoff") return !isSecondCutoff(p);
  if (item.schedule === "second_cutoff") return isSecondCutoff(p);
  return true;
}

/** The items that apply in a period, with the installment number for loans. */
export function itemsFor(items: PayItem[], employeeId: string, p: { start_date: string; end_date: string }) {
  const out: { item: PayItem; installment: number | null }[] = [];
  for (const item of items) {
    if (item.employee_id !== employeeId || !scheduleHits(item, p)) continue;
    if (item.installments) {
      const n = periodsBetween(item.start_date, p.start_date).filter((q) => scheduleHits(item, q)).length + 1;
      if (n > item.installments) continue;
      out.push({ item, installment: n });
    } else out.push({ item, installment: null });
  }
  return out;
}

/** Amount of an earning category paid in earlier periods of the given scope (month, semester or year). */
function paidBefore(items: PayItem[], employeeId: string, p: PayrollPeriod, match: (i: PayItem) => boolean, scope: "month" | "semester" | "year") {
  const y = p.start_date.slice(0, 4);
  const m = Number(p.start_date.slice(5, 7));
  const from = scope === "month" ? p.start_date.slice(0, 8) + "01" : scope === "semester" ? `${y}-${m <= 6 ? "01" : "07"}-01` : `${y}-01-01`;
  return periodsBetween(from, p.start_date).reduce((n, q) => n + itemsFor(items, employeeId, q).filter(({ item }) => match(item)).reduce((k, { item }) => k + item.amount, 0), 0);
}

/** De minimis excess that spilled into the ₱90,000 pool in earlier periods of the year. */
function deMinimisExcessBefore(items: PayItem[], employeeId: string, p: PayrollPeriod) {
  let total = 0;
  for (const q of periodsBetween(`${p.start_date.slice(0, 4)}-01-01`, p.start_date)) total += deMinimisSplit(items, employeeId, q, 0).excess;
  return total;
}

function deMinimisSplit(items: PayItem[], employeeId: string, p: PayrollPeriod, otMealCap: number) {
  let exempt = 0, excess = 0;
  const lines: { item: PayItem; exempt: number; excess: number }[] = [];
  for (const { item } of itemsFor(items, employeeId, p)) {
    if (item.category !== "de_minimis" || !item.de_minimis_kind) continue;
    const rule = RULES.deMinimis[item.de_minimis_kind];
    let room: number;
    if (rule.per === "ot_day") room = otMealCap;
    else {
      const before = paidBefore(items, employeeId, p, (i) => i.category === "de_minimis" && i.de_minimis_kind === item.de_minimis_kind, rule.per);
      const sameNow = lines.filter((l) => l.item.de_minimis_kind === item.de_minimis_kind).reduce((n, l) => n + l.item.amount, 0);
      room = Math.max(0, rule.cap - before - sameNow);
    }
    const ex = Math.min(item.amount, room);
    exempt += ex;
    excess += item.amount - ex;
    lines.push({ item, exempt: ex, excess: item.amount - ex });
  }
  return { exempt, excess, lines };
}

// ---- 13th month ------------------------------------------------------------------------

/** PD 851: one twelfth of the basic salary earned in the calendar year. Overtime, premiums, NSD and allowances are excluded. */
export function thirteenthMonthPay(db: Database, employee: Employee, year: number, unpaidTimeDeducted = 0) {
  const comp = db.compensation.find((c) => c.employee_id === employee.id && c.on_ph_payroll);
  if (!comp) return 0;
  const settings = db.payroll_settings ?? DEFAULT_SETTINGS;
  if (comp.is_managerial && !settings.thirteenth_month_for_managerial) return 0;
  const shift = db.shift_codes.find((s) => s.id === employee.shift_code_id);
  const from = employee.start_date > `${year}-01-01` ? employee.start_date : `${year}-01-01`;
  const to = employee.end_date && employee.end_date < `${year}-12-31` ? employee.end_date : `${year}-12-31`;
  if (to < from) return 0;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days < 30) return 0; // must have worked at least a month in the year
  const months = Math.min(12, days / (365 / 12));
  return Math.max(0, (rates(comp, shift, settings).monthly * months - unpaidTimeDeducted) / 12);
}

/** @deprecated kept for the payroll summary: estimate for the whole year. */
export function thirteenthMonthEstimate(comp: Compensation, shift: ShiftCode | undefined, startDate: string, year: number, settings: PayrollSettings = DEFAULT_SETTINGS) {
  if (comp.is_managerial && !settings.thirteenth_month_for_managerial) return 0;
  const from = startDate > `${year}-01-01` ? startDate : `${year}-01-01`;
  const months = Math.max(0, (Date.parse(`${year}-12-31`) - Date.parse(from)) / (86400000 * 30.44));
  return (rates(comp, shift, settings).monthly * Math.min(12, months)) / 12;
}

// ---- Payslip ---------------------------------------------------------------------

export interface PayLine { key: string; label: string; detail?: string; amount: number }

export interface Payslip {
  employee: Employee;
  comp: Compensation;
  shift: ShiftCode | undefined;
  period: PayrollPeriod;
  settings: PayrollSettings;
  days: DayCalc[];
  earnings: PayLine[]; // pay for time, premiums and overtime
  deductions: PayLine[]; // time not worked
  additions: PayLine[]; // allowances, benefits, commissions, reimbursements
  contributions: PayLine[]; // employee shares actually deducted
  otherDeductions: PayLine[]; // loans and authorized deductions taken this cutoff
  deferred: PayLine[]; // deductions that pay couldn't cover, carried to the next cutoff
  employer: PayLine[];
  gross: number;
  compensationForSss: number; // this cutoff's compensation, for the SSS and Pag-IBIG basis
  nonTaxable: number;
  taxable: number;
  tax: number;
  net: number;
  mwe: boolean;
  flags: string[];
  pendingRequests: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const hrs = (m: number) => `${(m / 60).toFixed(2).replace(/\.00$/, "")} h`;
const sumL = (ls: PayLine[]) => ls.reduce((n, l) => n + l.amount, 0);

function employeeSettings(db: Database, employeeId: string, s: PayrollSettings) {
  const o: Partial<EmployeePayrollSettings> = db.employee_payroll_settings?.find((x) => x.employee_id === employeeId) ?? {};
  return {
    employerPaysSss: o.employer_pays_sss ?? s.employer_pays_sss,
    employerPaysPh: o.employer_pays_philhealth ?? s.employer_pays_philhealth,
    employerPaysPag: o.employer_pays_pagibig ?? s.employer_pays_pagibig,
    pagibigVoluntary: o.pagibig_voluntary ?? 0,
  };
}

/** Was the employee present on their last scheduled workday before `date`? */
function presentOnLastWorkday(db: Database, employee: Employee, shift: ShiftCode | undefined, date: string) {
  for (let d = addDays(date, -1), i = 0; i < 14; d = addDays(d, -1), i++) {
    if (d < employee.start_date) return true; // no workday before: not held against a new joiner
    if (isWeekend(d)) continue;
    const h = db.holidays.find((x) => x.date === d && x.kind !== "special_working");
    const worked = db.time_records.some((r) => r.employee_id === employee.id && r.work_date === d && r.kind === "clock_in");
    if (h) { if (worked) return true; continue; } // successive holidays: working the earlier one counts
    return worked;
  }
  return true;
}

export interface PayslipOptions { basisOnly?: boolean }

export function computePayslip(db: Database, employee: Employee, period: PayrollPeriod, nowIso: string, opts: PayslipOptions = {}): Payslip | null {
  const settings = db.payroll_settings ?? DEFAULT_SETTINGS;
  const comp = db.compensation.find((c) => c.employee_id === employee.id && c.on_ph_payroll);
  if (!comp || employee.start_date > period.end_date || (employee.end_date && employee.end_date < period.start_date)) return null;
  const shift = db.shift_codes.find((s) => s.id === employee.shift_code_id);
  const rt = rates(comp, shift, settings);
  const nowMs = Date.parse(nowIso);
  const flags: string[] = [];
  const mwe = isMinimumWageEarner(comp, shift, settings);
  const managerial = comp.is_managerial;
  if (belowMinimumWage(comp, shift, settings)) flags.push(`Daily rate ₱${rt.daily.toFixed(2)} is below the ₱${settings.minimum_wage_daily} minimum (${settings.minimum_wage_label}).`);
  if (!shift) flags.push("No shift code, so no scheduled time can be paid. Assign one before finalizing.");

  const recs = db.time_records.filter((r) => r.employee_id === employee.id);
  const ot = db.overtime_requests.filter((r) => r.employee_id === employee.id);
  const holidayOn = (d: string) => db.holidays.find((h) => h.date === d);
  const days: DayCalc[] = [];
  let prevPresent = presentOnLastWorkday(db, employee, shift, period.start_date);
  for (const d of datesIn(period)) {
    if (d < employee.start_date || (employee.end_date && d > employee.end_date)) continue;
    const dayRecs = recs.filter((r) => r.work_date === d);
    const day = computeDay(
      d, shift, dayRecs,
      ot.filter((r) => r.work_date === d && r.status === "approved"),
      ot.filter((r) => r.work_date === d && r.status === "pending"),
      { holidayOn, prevWorkdayPresent: prevPresent, nowMs, managerial },
    );
    days.push(day);
    const worked = dayRecs.some((r) => r.kind === "clock_in");
    // Art. 94 IRR: presence is judged on the workday before. Rest days are skipped; for successive holidays,
    // an employee absent before the first is still paid the second if they work the first.
    if (day.type === "ordinary") prevPresent = worked || day.future;
    else if ((day.type === "regular" || day.type === "special") && worked) prevPresent = true;
  }

  const earnings: PayLine[] = [];
  const deductions: PayLine[] = [];
  const minRate = rt.hourly / 60;
  const segs = days.flatMap((d) => d.segments);
  const regSegs = segs.filter((s) => s.kind === "regular");

  if (comp.pay_basis === "monthly") {
    // Joiners and leavers mid-period are paid for the workdays they were employed.
    const all = datesIn(period).filter((d) => !isWeekend(d));
    const employed = all.filter((d) => d >= employee.start_date && (!employee.end_date || d <= employee.end_date));
    const share = all.length ? employed.length / all.length : 1;
    const basic = (rt.monthly / 2) * share;
    earnings.push({
      key: "basic", label: "Basic pay",
      detail: share < 1 ? `${employed.length} of ${all.length} workdays of ₱${(rt.monthly / 2).toLocaleString("en-PH")}` : `Half of ₱${rt.monthly.toLocaleString("en-PH")} monthly`,
      amount: basic,
    });
    const tardy = !managerial || settings.deduct_managerial_tardiness;
    const late = tardy ? days.reduce((n, d) => n + d.lateMin, 0) : 0;
    const under = tardy ? days.reduce((n, d) => n + d.undertimeMin, 0) : 0;
    const absentDays = days.filter((d) => d.absent);
    const holidayUnpaid = managerial ? [] : days.filter((d) => d.type === "regular" && !d.holidayPaidUnworked && !d.future && d.workedMin === 0 && !d.incomplete && shift);
    const specialUnpaid = settings.pay_unworked_special_days ? [] : days.filter((d) => d.specialUnworked);
    if (late) deductions.push({ key: "late", label: "Late", detail: `${hrs(late)} · actual minutes only, no fines`, amount: late * minRate });
    if (under) deductions.push({ key: "undertime", label: "Undertime", detail: `${hrs(under)} · can’t be offset by overtime (Art. 88)`, amount: under * minRate });
    if (absentDays.length) deductions.push({ key: "absent", label: "Absences", detail: `${absentDays.length} day${absentDays.length > 1 ? "s" : ""} · no work, no pay`, amount: absentDays.reduce((n, d) => n + d.scheduledMin, 0) * minRate });
    if (holidayUnpaid.length) deductions.push({ key: "holiday-ineligible", label: "Unpaid regular holiday", detail: "Absent on the workday before (Art. 94)", amount: holidayUnpaid.length * rt.scheduledDaily });
    if (specialUnpaid.length) deductions.push({ key: "special-unworked", label: "Special day not worked", detail: `${specialUnpaid.length} day · no work, no pay (company setting)`, amount: specialUnpaid.reduce((n, d) => n + d.scheduledMin, 0) * minRate });
    // Time not worked can't take basic pay below zero (e.g. absent for the whole cutoff).
    const totalDed = sumL(deductions);
    if (totalDed > basic) {
      const k = basic / totalDed;
      deductions.forEach((l) => (l.amount *= k));
      flags.push("Time not worked exceeds basic pay for this cutoff. Deductions are capped at basic pay.");
    }
  } else {
    const worked = regSegs.reduce((n, s) => n + s.min, 0);
    earnings.push({ key: "basic", label: "Basic pay", detail: `${hrs(worked)} × ₱${rt.hourly.toFixed(2)}`, amount: worked * minRate });
    const hol = managerial ? [] : days.filter((d) => d.holidayPaidUnworked);
    if (hol.length) earnings.push({ key: "holiday-unworked", label: "Regular holiday pay (not worked)", detail: `${hol.length} day · 100% (Art. 94)`, amount: hol.reduce((n, d) => n + d.scheduledMin, 0) * minRate });
    const spc = settings.pay_unworked_special_days ? days.filter((d) => d.specialUnworked) : [];
    if (spc.length) earnings.push({ key: "special-unworked", label: "Special day pay (not worked)", detail: `${spc.length} day · company policy`, amount: spc.reduce((n, d) => n + d.scheduledMin, 0) * minRate });
  }

  // Holiday premiums on scheduled time, by the calendar date the minutes fell on.
  const premGroups = new Map<DayType, number>();
  for (const s of regSegs) if (s.mult > 1) premGroups.set(s.dayType, (premGroups.get(s.dayType) ?? 0) + s.min);
  for (const [t, min] of premGroups) {
    const m = dayMultiplier(t);
    earnings.push({ key: `prem-${t}`, label: `${dayLabel(t)} premium`, detail: `${hrs(min)} at +${Math.round((m - 1) * 100)}% (${t.startsWith("regular") ? "Art. 94" : "Art. 93"})`, amount: min * minRate * (m - 1) });
  }

  // Overtime and work on unscheduled days, grouped by multiplier.
  const otGroups = new Map<string, { min: number; mult: number }>();
  for (const s of segs.filter((x) => x.kind === "ot")) {
    const label = s.dayType === "ordinary" ? `Overtime, regular day · ${pct(s.mult)}` : s.mult === dayMultiplier(s.dayType) ? `${dayLabel(s.dayType)} work, first 8 h · ${pct(s.mult)}` : `${dayLabel(s.dayType)} overtime · ${pct(s.mult)}`;
    const g = otGroups.get(label) ?? { min: 0, mult: s.mult };
    g.min += s.min;
    otGroups.set(label, g);
  }
  for (const [label, g] of otGroups) earnings.push({ key: `ot-${label}`, label, detail: `${hrs(g.min)} approved`, amount: g.min * minRate * g.mult });

  // Night shift differential: +10% of the hourly rate that applies to those minutes (holiday, rest day or overtime rate).
  const nsdMin = segs.reduce((n, s) => n + s.nightMin, 0);
  const nsdAmt = segs.reduce((n, s) => n + s.nightMin * minRate * s.mult * RULES.nightDifferential, 0);
  if (nsdMin >= 1) earnings.push({ key: "nsd", label: "Night shift differential", detail: `${hrs(Math.round(nsdMin))} between 10 PM and 6 AM at +10% of the rate for those hours (Art. 86)`, amount: nsdAmt });

  const unapproved = days.reduce((n, d) => n + d.unapprovedExtraMin, 0);
  const incomplete = days.filter((d) => d.incomplete).length;
  if (incomplete) flags.push(`${incomplete} day${incomplete > 1 ? "s" : ""} with a time in but no time out. Unpaid until a time correction is approved.`);
  if (unapproved) flags.push(`${hrs(unapproved)} recorded outside the schedule without approved overtime. Not paid unless an overtime request is filed and approved.`);

  const timePay = sumL(earnings) - sumL(deductions); // basic, premiums, OT and NSD, less time not worked
  const statutoryPay = timePay; // what a minimum wage earner is exempt on

  // ---- Allowances, benefits and other additions ----
  const additions: PayLine[] = [];
  const applied = itemsFor(db.pay_items ?? [], employee.id, period);
  let taxableAdditions = 0, sssAdditions = 0, nonTaxable = 0, poolThis = 0;
  for (const { item } of applied.filter((a) => a.item.direction === "earning")) {
    const c = item.category;
    if (c === "de_minimis") continue;
    additions.push({ key: `add-${item.id}`, label: item.label, detail: earningNote(c), amount: item.amount });
    if (c === "taxable_allowance" || c === "commission" || c === "adjustment") { taxableAdditions += item.amount; sssAdditions += item.amount; }
    else if (c === "other_benefit") poolThis += item.amount;
    else if (c === "reimbursement") nonTaxable += item.amount;
  }
  const otDays = days.filter((d) => d.otMin > 0 || d.nsdMin > 0).length;
  const dm = deMinimisSplit(db.pay_items ?? [], employee.id, period, otDays * rt.daily * RULES.otMealShareOfDaily);
  for (const l of dm.lines) {
    const rule = RULES.deMinimis[l.item.de_minimis_kind!];
    additions.push({ key: `add-${l.item.id}`, label: l.item.label, detail: l.excess > 0 ? `De minimis: ${peso(l.exempt)} tax-free, ${peso(l.excess)} over the ${rule.per === "ot_day" ? "30%-of-daily-wage" : `${peso(rule.cap)} per ${rule.per}`} ceiling` : `De minimis, tax-free (RR 29-2025)`, amount: l.item.amount });
  }
  nonTaxable += dm.exempt;
  poolThis += dm.excess;

  // 13th month: added automatically to the last payroll paid on or before December 24 (PD 851).
  if (period.start_date.endsWith("-12-01") && !opts.basisOnly) {
    const year = Number(period.start_date.slice(0, 4));
    const amt = thirteenthMonthPay(db, employee, year);
    if (amt > 0) {
      additions.push({ key: "13th", label: "13th month pay", detail: `1/12 of basic pay earned in ${year} (PD 851)`, amount: amt });
      poolThis += amt;
    }
  }

  // ₱90,000 a year of 13th month and other benefits is tax-free; past that it's taxable.
  const poolBefore = paidBefore(db.pay_items ?? [], employee.id, period, (i) => i.category === "other_benefit", "year") + deMinimisExcessBefore(db.pay_items ?? [], employee.id, period);
  const poolTaxable = Math.max(0, poolBefore + poolThis - RULES.thirteenthMonthTaxFree) - Math.max(0, poolBefore - RULES.thirteenthMonthTaxFree);
  nonTaxable += poolThis - poolTaxable;
  if (poolTaxable > 0) flags.push(`${peso(poolTaxable)} of benefits is over the ${peso(RULES.thirteenthMonthTaxFree)} yearly tax-free limit and is taxed.`);

  const gross = timePay + sumL(additions);
  const compensationForSss = timePay + sssAdditions;

  // ---- Government contributions ----
  const es = employeeSettings(db, employee.id, settings);
  const contributions: PayLine[] = [];
  const employer: PayLine[] = [];
  let employerPaidEeShare = 0;
  if (!opts.basisOnly) {
    const second = isSecondCutoff(period);
    const timing = settings.contribution_timing;
    const due = timing === "split" || (timing === "first_cutoff" ? !second : second);
    // A joiner with no pay in the month's first cutoff gets the whole month on the second.
    let firstSlip: Payslip | null = null;
    if (second) firstSlip = computePayslip(db, employee, firstCutoffOfMonth(period), nowIso, { basisOnly: true });
    const firstHadPay = !!firstSlip && firstSlip.compensationForSss > 0;
    const actual = settings.sss_basis === "actual_compensation";

    let sssBasis: number, sssBasisNote: string;
    if (actual && timing !== "first_cutoff") {
      if (second) { sssBasis = (firstSlip?.compensationForSss ?? 0) + compensationForSss; sssBasisNote = "this month’s actual compensation"; }
      else { sssBasis = compensationForSss * 2; sssBasisNote = "this cutoff’s compensation × 2, trued up on the 16th–end cutoff"; }
    } else { sssBasis = rt.monthly; sssBasisNote = "monthly rate"; }
    const month = monthlyContributions(sssBasis, rt.monthly, sssBasis);
    let share = 1;
    let alreadyFirst = { sssEe: 0, phEe: 0, pagEe: 0, sssEr: 0, phEr: 0, pagEr: 0 };
    if (timing === "split") {
      if (!second) share = 0.5;
      else if (firstHadPay) {
        const firstBasis = actual ? firstSlip!.compensationForSss * 2 : rt.monthly;
        const f = monthlyContributions(firstBasis, rt.monthly, firstBasis);
        alreadyFirst = { sssEe: f.sssEe / 2, phEe: f.phEe / 2, pagEe: f.pagEe / 2, sssEr: f.sssEr / 2, phEr: f.phEr / 2, pagEr: f.pagEr / 2 };
      }
    }
    if (compensationForSss <= 0 && !(second && firstHadPay)) {
      flags.push("No compensation this cutoff, so no contributions are due.");
    } else if (due) {
      const part = (k: keyof typeof alreadyFirst) => Math.max(0, month[k] * share - alreadyFirst[k]);
      const when = timing === "split" ? (second ? (firstHadPay ? "rest of the month" : "whole month") : "half this cutoff") : "whole month";
      const lines: [string, string, number, number, boolean, string][] = [
        ["sss", "SSS", part("sssEe"), part("sssEr"), es.employerPaysSss, `5% of ₱${month.msc.toLocaleString("en-PH")} salary credit (${sssBasisNote}), ${when}`],
        ["philhealth", "PhilHealth", part("phEe"), part("phEr"), es.employerPaysPh, `2.5% of basic salary, ${when}`],
        ["pagibig", "Pag-IBIG", part("pagEe"), part("pagEr"), es.employerPaysPag, `2% up to ₱10,000, ${when}`],
      ];
      for (const [key, label, ee, er, employerPays, detail] of lines) {
        if (employerPays) {
          employerPaidEeShare += ee;
          employer.push({ key: `${key}-ee-by-er`, label: `${label} employee share, paid by the company`, amount: ee });
        } else contributions.push({ key, label, detail, amount: ee });
        employer.push({ key: `${key}-er`, label: key === "sss" ? "SSS (incl. EC)" : label, amount: er });
      }
      if (es.pagibigVoluntary > 0) {
        const v = timing === "split" ? es.pagibigVoluntary / 2 : es.pagibigVoluntary;
        contributions.push({ key: "pagibig-voluntary", label: "Pag-IBIG, voluntary extra", detail: "Employee’s own election; taken after tax", amount: v });
      }
    }
  }
  const mandatoryEe = sumL(contributions.filter((l) => l.key !== "pagibig-voluntary"));

  // ---- Withholding tax ----
  const unionDues = applied.filter((a) => a.item.direction === "deduction" && a.item.category === "union_dues" && a.item.authorization).reduce((n, a) => n + a.item.amount, 0);
  const otherTaxable = taxableAdditions + poolTaxable + employerPaidEeShare;
  // Minimum wage earners are exempt on the minimum wage, holiday pay, OT, NSD and hazard pay; other income is still taxed.
  const taxable = Math.max(0, (mwe ? otherTaxable : statutoryPay + otherTaxable - mandatoryEe) - unionDues);
  const tax = withholdingSemiMonthly(taxable);

  // ---- Loans and other deductions, within what's left ----
  const otherDeductions: PayLine[] = [];
  const deferred: PayLine[] = [];
  let available = gross - sumL(contributions) - tax;
  const dedItems = applied.filter((a) => a.item.direction === "deduction")
    .sort((a, b) => DEDUCTION_PRIORITY.indexOf(a.item.category as DeductionCategory) - DEDUCTION_PRIORITY.indexOf(b.item.category as DeductionCategory));
  for (const { item, installment } of dedItems) {
    const cat = item.category as DeductionCategory;
    if (!NO_AUTH_NEEDED.includes(cat) && !item.authorization) {
      flags.push(`${item.label} not deducted: it needs the employee’s signed authorization on file (Art. 113, DO 195-18).`);
      continue;
    }
    let amt = item.amount;
    if (cat === "loss_damage") {
      const cap = RULES.lossDamageMaxShare * timePay;
      if (amt > cap) { deferred.push({ key: `def-${item.id}-cap`, label: item.label, detail: "Over the 20% of wages limit (Art. 114–115)", amount: amt - cap }); amt = cap; }
    }
    const take = Math.max(0, Math.min(amt, available));
    const detail = [deductionNote(cat), installment && item.installments ? `installment ${installment} of ${item.installments}` : null].filter(Boolean).join(" · ");
    if (take > 0) otherDeductions.push({ key: `ded-${item.id}`, label: item.label, detail, amount: take });
    if (amt - take > 0.004) deferred.push({ key: `def-${item.id}`, label: item.label, detail: "Pay this cutoff can’t cover it; carried to the next", amount: amt - take });
    available -= take;
  }
  if (deferred.length) flags.push(`${peso(sumL(deferred))} of deductions couldn’t be taken this cutoff and carries over.`);

  const pendingRequests =
    db.overtime_requests.filter((r) => r.employee_id === employee.id && r.status === "pending" && r.work_date >= period.start_date && r.work_date <= period.end_date).length +
    db.correction_requests.filter((r) => r.employee_id === employee.id && r.status === "pending" && r.work_date >= period.start_date && r.work_date <= period.end_date).length;
  if (pendingRequests) flags.push(`${pendingRequests} request${pendingRequests > 1 ? "s" : ""} still waiting for approval in this period.`);

  const round = (ls: PayLine[]) => ls.map((l) => ({ ...l, amount: r2(l.amount) }));
  const net = gross - sumL(contributions) - tax - sumL(otherDeductions);
  return {
    employee, comp, shift, period, settings, days,
    earnings: round(earnings), deductions: round(deductions), additions: round(additions),
    contributions: round(contributions), otherDeductions: round(otherDeductions), deferred: round(deferred), employer: round(employer),
    gross: r2(gross), compensationForSss: r2(compensationForSss), nonTaxable: r2(nonTaxable), taxable: r2(taxable), tax: r2(tax), net: r2(net),
    mwe, flags, pendingRequests,
  };
}

function earningNote(c: string) {
  return ({ taxable_allowance: "Allowance, taxable", other_benefit: "Benefit, tax-free within the ₱90,000 yearly limit", commission: "Commission, taxable", reimbursement: "Reimbursement of liquidated expenses, not taxed", adjustment: "Adjustment, taxable" } as Record<string, string>)[c];
}
function deductionNote(c: DeductionCategory) {
  return { sss_loan: "SSS loan, authorized by law", pagibig_loan: "Pag-IBIG loan, authorized by law", company_loan: "Company loan, signed authorization on file", union_dues: "Union dues, check-off authorization", insurance: "Insurance premium, with consent", loss_damage: "Loss or damage, after due process", other_authorized: "Signed authorization on file" }[c];
}

function pct(m: number) { return `${Math.round(m * 1000) / 10}%`; }
function dayLabel(t: DayType) {
  return { ordinary: "Regular day", rest: "Rest day", special: "Special day", special_rest: "Special day on rest day", regular: "Regular holiday", regular_rest: "Regular holiday on rest day" }[t];
}

export const peso = (n: number) => `${n < 0 ? "−" : ""}₱${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
