// Year-end tax: annualization of withholding tax, BIR Form 2316 figures, monthly 1601-C totals and the 1604-C alphalist.
// NIRC Sec. 24(A) as amended by TRAIN (RA 10963), 2023 onward rates; RR 2-98 Sec. 2.79(B)(5) on annualization;
// RR 11-2018 on substituted filing. Sources in docs/year-end-tax.md.

import type { Database, Employee, PayrollPeriod } from "./types";
import { addDays } from "./format";
import { computePayslip, periodFor, type Payslip } from "./payroll";

/** Annual income tax on compensation, 2023 onward (NIRC Sec. 24(A)(2) as amended by RA 10963). */
export const ANNUAL_TAX_TABLE = [
  { over: 0, fixed: 0, rate: 0 },
  { over: 250000, fixed: 0, rate: 0.15 },
  { over: 400000, fixed: 22500, rate: 0.2 },
  { over: 800000, fixed: 102500, rate: 0.25 },
  { over: 2000000, fixed: 402500, rate: 0.3 },
  { over: 8000000, fixed: 2202500, rate: 0.35 },
];

export function annualTax(taxable: number) {
  const row = [...ANNUAL_TAX_TABLE].reverse().find((r) => taxable > r.over) ?? ANNUAL_TAX_TABLE[0];
  return Math.round(Math.max(0, row.fixed + (taxable - row.over) * row.rate) * 100) / 100;
}

export const isLastPeriodOfYear = (p: { start_date: string }) => p.start_date.endsWith("-12-16");

const asPeriod = (p: Omit<PayrollPeriod, "status" | "finalized_at" | "finalized_by">): PayrollPeriod => ({ ...p, status: "open", finalized_at: null, finalized_by: null });

/** Semi-monthly periods from `from` up to and including the one that contains `to`. */
export function periodsFrom(from: string, to: string): PayrollPeriod[] {
  const out: PayrollPeriod[] = [];
  for (let p = periodFor(from); p.start_date <= to; p = periodFor(addDays(p.end_date, 1))) out.push(asPeriod(p));
  return out;
}

export interface YearToDate {
  opening: Database["payroll_openings"][number] | null;
  slips: Payslip[]; // periods run in the app, before the one being computed
  gross: number;
  taxable: number;
  nonTaxable: number;
  mandatory: number;
  taxWithheld: number;
}

/**
 * Everything earned and withheld in the year before `beforeStart`: figures imported at go-live, then each period run in the app.
 * Periods after today are projected from the schedule, so a December figure is an estimate until December is paid.
 */
export function yearToDate(db: Database, employee: Employee, year: number, beforeStart: string, nowIso: string): YearToDate {
  const opening = db.payroll_openings.find((o) => o.employee_id === employee.id && o.year === year) ?? null;
  let from = opening ? addDays(opening.through_date, 1) : `${year}-01-01`;
  if (employee.start_date > from) from = employee.start_date;
  const slips: Payslip[] = [];
  if (from < beforeStart) {
    for (const p of periodsFrom(from, addDays(beforeStart, -1))) {
      const s = computePayslip(db, employee, p, nowIso, { noAnnualize: true });
      if (s) slips.push(s);
    }
  }
  const sum = (f: (s: Payslip) => number) => slips.reduce((n, s) => n + f(s), 0);
  const mandatory = (s: Payslip) => s.contributions.filter((l) => l.key !== "pagibig-voluntary").reduce((n, l) => n + l.amount, 0);
  return {
    opening, slips,
    gross: (opening ? opening.taxable_compensation + opening.non_taxable_benefits + opening.mandatory_contributions : 0) + sum((s) => s.gross),
    taxable: (opening?.taxable_compensation ?? 0) + sum((s) => s.taxable),
    nonTaxable: (opening?.non_taxable_benefits ?? 0) + sum((s) => s.nonTaxable),
    mandatory: (opening?.mandatory_contributions ?? 0) + sum(mandatory),
    taxWithheld: (opening?.tax_withheld ?? 0) + sum((s) => s.tax),
  };
}

export interface AnnualSummary {
  employee: Employee;
  year: number;
  slips: Payslip[]; // every period of the year run in the app, December included
  opening: YearToDate["opening"];
  gross: number;
  nonTaxable: number; // 13th month and other benefits within ₱90,000, de minimis, reimbursements
  mandatory: number; // SSS, PhilHealth and Pag-IBIG employee shares, union dues
  taxable: number;
  taxDue: number;
  taxWithheld: number; // January to November, plus the December adjustment
  decemberAdjustment: number; // + collected, − refunded in the last payroll of the year
  estimated: boolean; // some periods are still in the future
  mwe: boolean;
  substitutedFiling: boolean; // RR 11-2018: one employer all year, tax correctly withheld
  months: { month: string; gross: number; taxable: number; tax: number }[];
}

export function annualSummary(db: Database, employee: Employee, year: number, nowIso: string): AnnualSummary | null {
  const comp = db.compensation.find((c) => c.employee_id === employee.id && c.on_ph_payroll);
  if (!comp || employee.start_date > `${year}-12-31` || (employee.end_date && employee.end_date < `${year}-01-01`)) return null;
  const ytd = yearToDate(db, employee, year, `${year + 1}-01-01`, nowIso);
  // The last period carries the annualization; recompute it with it on.
  const lastStart = employee.end_date && employee.end_date < `${year}-12-16` ? periodFor(employee.end_date).start_date : `${year}-12-16`;
  const slips = ytd.slips.map((s) => (s.period.start_date === lastStart ? computePayslip(db, employee, s.period, nowIso) ?? s : s));
  const last = slips.find((s) => s.period.start_date === lastStart);
  const withheldBefore = (ytd.opening?.tax_withheld ?? 0) + slips.filter((s) => s !== last).reduce((n, s) => n + s.tax, 0);
  const taxDue = annualTax(ytd.taxable);
  const months = new Map<string, { month: string; gross: number; taxable: number; tax: number }>();
  for (const s of slips) {
    const m = s.period.start_date.slice(0, 7);
    const row = months.get(m) ?? { month: m, gross: 0, taxable: 0, tax: 0 };
    row.gross += s.gross; row.taxable += s.taxable; row.tax += s.tax;
    months.set(m, row);
  }
  const today = nowIso.slice(0, 10);
  return {
    employee, year, slips, opening: ytd.opening,
    gross: ytd.gross, nonTaxable: ytd.nonTaxable, mandatory: ytd.mandatory, taxable: ytd.taxable,
    taxDue, taxWithheld: withheldBefore + (last?.tax ?? 0), decemberAdjustment: last?.tax ?? 0,
    estimated: slips.some((s) => s.period.end_date >= today),
    mwe: slips.some((s) => s.mwe),
    substitutedFiling: !employee.end_date && employee.start_date <= `${year}-01-01`,
    months: [...months.values()],
  };
}

/** Deadlines for the year's returns (RR 2-98 as amended; RR 11-2018). */
export function yearEndDeadlines(year: number) {
  return [
    { form: "BIR Form 2316", what: "Certificate of compensation and tax withheld, one for each employee", due: `${year + 1}-01-31`, note: "Give it to each employee. Also give it on the day of separation to anyone who leaves during the year." },
    { form: "BIR Form 1604-C", what: "Annual information return with the alphalist of employees", due: `${year + 1}-01-31`, note: "Filed through eFPS or eBIRForms, with the alphalist." },
    { form: "Duplicate 2316s", what: "Signed copies for employees qualified for substituted filing", due: `${year + 1}-02-28`, note: "Submitted to the BIR so these employees don't file their own annual return." },
    { form: "BIR Form 1601-C", what: "Monthly remittance of tax withheld on compensation", due: "10th of the next month", note: "Up to the 15th for eFPS filers, by industry group. December's return carries the year-end adjustment." },
  ];
}
