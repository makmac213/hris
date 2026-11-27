// Final pay: what is owed when someone leaves, computed from the law as the floor.
// DOLE Labor Advisory 06-20 (release within 30 days; certificate of employment within 3 days of a request),
// Labor Code Art. 298–300 [283–285] (separation pay, notice), RA 7641 (retirement pay), PD 851 (13th month),
// Art. 95 (SIL conversion), NIRC Sec. 32(B)(6) (tax exemptions). Sources in docs/final-pay.md.

import type { Database, Employee, SeparationReason } from "./types";
import { addDays, formatDate } from "./format";
import { computePayslip, effectiveItems, itemsFor, periodFor, peso, rates, RULES, thirteenthMonthPay, type PayLine, type Payslip } from "./payroll";
import { convertibleDays, SIL_ID } from "./leave";
import { balanceBefore, LOAN_KINDS } from "./loans";
import { ageOn, creditedYears, separationLabel } from "./employment";
import { annualTax, periodsFrom, yearToDate } from "./yearend";

export interface SeparationRule {
  /** Months of pay per credited year, with a floor of one month (Art. 298–299). 0 = none required by law. */
  perYear: number;
  floorMonths: number;
  taxExempt: boolean;
  notice: string;
  basis: string;
}

export const SEPARATION_RULES: Record<SeparationReason, SeparationRule> = {
  resignation: { perYear: 0, floorMonths: 0, taxExempt: false, basis: "None required by law (Art. 300). Pay it only if a contract, CBA or company policy says so; it's taxable.", notice: "The employee gives written notice at least 30 days ahead, unless the company waives it or there's just cause (Art. 300)." },
  end_of_contract: { perYear: 0, floorMonths: 0, taxExempt: false, basis: "None required when a genuine project, season or fixed term ends.", notice: "Report the termination of project employees to the DOLE regional office (DO 19-93)." },
  failed_probation: { perYear: 0, floorMonths: 0, taxExempt: false, basis: "None required.", notice: "Written notice that the standards made known at hiring weren't met, within a reasonable time before probation ends (Art. 296; IRR Book VI Rule I Sec. 2)." },
  just_cause: { perYear: 0, floorMonths: 0, taxExempt: false, basis: "None required for serious misconduct, willful disobedience, neglect, fraud or a crime (Art. 297).", notice: "Two written notices and a chance to be heard: a notice to explain, then a notice of decision." },
  redundancy: { perYear: 1, floorMonths: 1, taxExempt: true, basis: "One month's pay per year of service, or one month, whichever is higher (Art. 298).", notice: "Written notice to the employee and to DOLE at least one month before the last day (Art. 298)." },
  labor_saving: { perYear: 1, floorMonths: 1, taxExempt: true, basis: "One month's pay per year of service, or one month, whichever is higher (Art. 298).", notice: "Written notice to the employee and to DOLE at least one month before the last day (Art. 298)." },
  retrenchment: { perYear: 0.5, floorMonths: 1, taxExempt: true, basis: "Half a month's pay per year of service, or one month, whichever is higher (Art. 298).", notice: "Written notice to the employee and to DOLE at least one month before the last day (Art. 298). The tax exemption needs a BIR certificate (RMO 66-2016)." },
  closure: { perYear: 0.5, floorMonths: 1, taxExempt: true, basis: "Half a month's pay per year of service, or one month, whichever is higher (Art. 298).", notice: "Written notice to the employee and to DOLE at least one month before the last day (Art. 298)." },
  closure_losses: { perYear: 0, floorMonths: 0, taxExempt: true, basis: "None required when the closure is due to proven serious business losses (Art. 298).", notice: "Written notice to the employee and to DOLE at least one month before the last day (Art. 298)." },
  disease: { perYear: 0.5, floorMonths: 1, taxExempt: true, basis: "Half a month's pay per year of service, or one month, whichever is higher (Art. 299). Needs a public health authority's certificate that the disease can't be cured within six months.", notice: "Written notice with the medical certification." },
  retirement: { perYear: 0, floorMonths: 0, taxExempt: true, basis: "Retirement pay under RA 7641 or the company's plan, whichever is higher.", notice: "Agree the retirement date in writing. 65 is the compulsory age under RA 7641." },
  death: { perYear: 0, floorMonths: 0, taxExempt: true, basis: "None under the Labor Code; pay any company death benefit. Final pay goes to the legal heirs.", notice: "Release final pay to the heirs on proof of relationship (and an extrajudicial settlement where required)." },
};

const AUTHORIZED: SeparationReason[] = ["redundancy", "labor_saving", "retrenchment", "closure", "closure_losses", "disease"];

export interface FinalPayLine extends PayLine { taxable: number }

export interface FinalPay {
  employee: Employee;
  lastDay: string;
  reason: SeparationReason;
  lastSlip: Payslip | null; // pay for the last, partial cutoff
  lines: FinalPayLine[]; // amounts added on top of the last cutoff's net
  deductions: PayLine[];
  statutoryLoans: PayLine[]; // SSS and Pag-IBIG loan balances: report to the agency
  taxAdjustment: number; // + withheld, − refunded after annualizing the year to the last day
  total: number; // last cutoff net + lines − deductions − tax adjustment
  dueBy: string;
  checks: { ok: boolean; text: string }[];
  years: number;
  age: number | null;
  retirement: { eligible: boolean; amount: number; note: string };
}

/** Months of pay as a peso amount: the latest monthly rate (Art. 298 uses the current wage). */
const monthPay = (db: Database, e: Employee) => {
  const comp = db.compensation.find((c) => c.employee_id === e.id && c.on_ph_payroll);
  const shift = db.shift_codes.find((s) => s.id === e.shift_code_id);
  return comp ? rates(comp, shift, db.payroll_settings).monthly : 0;
};

export function separationPay(db: Database, e: Employee, lastDay: string, reason: SeparationReason) {
  const r = SEPARATION_RULES[reason];
  const years = creditedYears(e.start_date, addDays(lastDay, 1));
  const amount = r.perYear || r.floorMonths ? Math.max(r.floorMonths, r.perYear * years) * monthPay(db, e) : 0;
  return { amount, years, rule: r };
}

/**
 * RA 7641: at 60 to 65 with at least five years of service, and no better company plan, at least half a month's salary per year.
 * "Half a month" is 22.5 days: 15 days' pay, 1/12 of the 13th month (2.5 days) and 5 days of service incentive leave.
 */
export function retirementPay(db: Database, e: Employee, lastDay: string) {
  const age = e.birth_date ? ageOn(e.birth_date, lastDay) : null;
  const years = creditedYears(e.start_date, addDays(lastDay, 1));
  const comp = db.compensation.find((c) => c.employee_id === e.id && c.on_ph_payroll);
  const shift = db.shift_codes.find((s) => s.id === e.shift_code_id);
  const daily = comp ? rates(comp, shift, db.payroll_settings).daily : 0;
  if (age === null) return { eligible: false, amount: 0, age, years, note: "Add a birth date to check retirement eligibility." };
  const eligible = age >= 60 && years >= 5;
  return {
    eligible, age, years,
    amount: eligible ? 22.5 * daily * years : 0,
    note: eligible
      ? `Age ${age}, ${years} credited years: 22.5 days × ${peso(daily)} × ${years} (RA 7641). Tax-exempt, once in a lifetime.`
      : `Age ${age}, ${years} credited years. RA 7641 needs age 60 to 65 and at least 5 years.`,
  };
}

export function finalPay(db: Database, employee: Employee, lastDay: string, reason: SeparationReason, nowIso: string, noticeDate: string | null = employee.separation_notice_date): FinalPay {
  const e: Employee = { ...employee, end_date: lastDay };
  const year = Number(lastDay.slice(0, 4));
  const comp = db.compensation.find((c) => c.employee_id === e.id && c.on_ph_payroll);
  const shift = db.shift_codes.find((s) => s.id === e.shift_code_id);
  const rt = comp ? rates(comp, shift, db.payroll_settings) : null;
  const period = { ...periodFor(lastDay), status: "open" as const, finalized_at: null, finalized_by: null };
  const lastSlip = computePayslip(db, e, period, nowIso, { noAnnualize: true });
  const lines: FinalPayLine[] = [];
  const checks: FinalPay["checks"] = [];

  // 13th month earned this year, less any already paid (PD 851: pro rata on separation).
  const thirteenth = thirteenthMonthPay(db, e, year);
  const paidDec = lastDay >= `${year}-12-15` ? thirteenthMonthPay(db, { ...employee, end_date: null }, year) : 0;
  const opening = db.payroll_openings.find((o) => o.employee_id === e.id && o.year === year);
  const already = (opening?.thirteenth_paid ?? 0) + paidDec;
  const owed13 = Math.max(0, thirteenth - already);
  const poolUsed = (opening?.non_taxable_benefits ?? 0) + paidDec;
  const poolRoom = Math.max(0, RULES.thirteenthMonthTaxFree - poolUsed);
  if (owed13 > 0) lines.push({ key: "13th", label: "13th month pay, pro rata", detail: `1/12 of basic pay earned Jan 1 to ${formatDate(lastDay)}${already ? `, less ${peso(already)} already paid` : ""}`, amount: owed13, taxable: Math.max(0, owed13 - poolRoom) });

  // Unused convertible leave: all of it is paid out on separation, nothing is carried.
  let vlFree = RULES.monetizedLeaveTaxFreeDays;
  for (const { type, days } of convertibleDays(db, e, year, lastDay)) {
    const amount = days * (rt?.daily ?? 0);
    const vacation = type.counts_as_sil || type.id === SIL_ID;
    const free = vacation ? Math.min(days, vlFree) : 0;
    vlFree -= free;
    lines.push({ key: `leave-${type.id}`, label: `${type.name}, unused days`, detail: `${days} day${days === 1 ? "" : "s"} × ${peso(rt?.daily ?? 0)}`, amount, taxable: amount - free * (rt?.daily ?? 0) });
  }

  // Separation or retirement pay.
  const sep = separationPay(db, e, lastDay, reason);
  if (sep.amount > 0) lines.push({ key: "separation", label: "Separation pay", detail: `${sep.rule.basis.split(" (")[0]}: ${sep.years} credited year${sep.years === 1 ? "" : "s"} × ${peso(monthPay(db, e))}`, amount: sep.amount, taxable: sep.rule.taxExempt ? 0 : sep.amount });
  const ret = retirementPay(db, e, lastDay);
  if (reason === "retirement") {
    if (ret.eligible) lines.push({ key: "retirement", label: "Retirement pay (RA 7641)", detail: ret.note, amount: ret.amount, taxable: 0 });
    else checks.push({ ok: false, text: `${ret.note} Pay under the company's retirement plan, if any; otherwise this is a resignation in law.` });
  }

  // Remaining loan balances. Company loans are deducted only with the signed authorization; government loans are reported.
  const deductions: PayLine[] = [];
  const statutoryLoans: PayLine[] = [];
  for (const item of effectiveItems(db, e).filter((i) => i.direction === "deduction" && i.installments)) {
    const paid = periodsFrom(item.start_date, lastDay).filter((p) => itemsFor([item], e.id, p).length).length;
    const left = Math.max(0, item.installments! - paid);
    if (!left) continue;
    const line = { key: `bal-${item.id}`, label: `${item.label}, remaining balance`, detail: `${left} installment${left === 1 ? "" : "s"} × ${peso(item.amount)}`, amount: left * item.amount };
    if (item.category === "sss_loan" || item.category === "pagibig_loan") statutoryLoans.push(line);
    else if (item.authorization) deductions.push(line);
    else checks.push({ ok: false, text: `${item.label}: ${peso(left * item.amount)} unpaid, but there's no signed authorization on file, so it can't be deducted from final pay (Art. 113).` });
  }
  // Loans (lib/loans.ts): the balance left after the last payroll.
  const after = periodFor(addDays(periodFor(lastDay).end_date, 1));
  for (const loan of (db.loans ?? []).filter((l) => l.employee_id === e.id && (l.status === "active" || l.status === "paused"))) {
    const left = balanceBefore(db, loan, after);
    if (left <= 0.004) continue;
    const info = LOAN_KINDS[loan.kind];
    const line = { key: `bal-${loan.id}`, label: `${info.label}${loan.reference_no ? ` (${loan.reference_no})` : ""}, remaining balance`, detail: `${peso(loan.principal)} loan, balance after the last payroll`, amount: left };
    if (info.agency) statutoryLoans.push(line);
    else if (loan.authorization) deductions.push(line);
    else checks.push({ ok: false, text: `${info.label}: ${peso(left)} unpaid, but there's no signed authorization on file, so it can't be deducted from final pay (Art. 113).` });
  }

  // Annualize the year up to the last day: final pay often brings a refund of excess withholding.
  let taxAdjustment = 0;
  if (lastSlip) {
    const ytd = yearToDate(db, e, year, period.start_date, nowIso);
    const taxable = ytd.taxable + lastSlip.taxable + lines.reduce((n, l) => n + l.taxable, 0);
    const withheld = ytd.taxWithheld + lastSlip.tax;
    taxAdjustment = annualTax(taxable) - withheld;
  }

  const lastNet = lastSlip?.net ?? 0;
  const total = lastNet + lines.reduce((n, l) => n + l.amount, 0) - deductions.reduce((n, l) => n + l.amount, 0) - taxAdjustment;

  // Checks on notice and timing.
  const days = noticeDate ? (Date.parse(lastDay) - Date.parse(noticeDate)) / 86400000 : null;
  if (reason === "resignation") checks.push({ ok: days !== null && days >= 30, text: days === null ? "No resignation letter date on file. The law asks for 30 days' written notice (Art. 300)." : days >= 30 ? `Resignation notice given ${days} days ahead.` : `Notice was ${days} days, under the 30 the law asks for. The company can waive it; record that it did.` });
  if (AUTHORIZED.includes(reason)) checks.push({ ok: days !== null && days >= 30, text: days !== null && days >= 30 ? `Notice to the employee and DOLE served ${days} days ahead.` : "Authorized-cause separation needs written notice to the employee and to DOLE at least one month ahead (Art. 298). Without it the dismissal can be held procedurally defective, with nominal damages." });
  if (reason === "just_cause") checks.push({ ok: false, text: "Confirm the two-notice process was followed and documented before the last day." });
  if (reason === "failed_probation" && !e.standards_given_on) checks.push({ ok: false, text: "No written probation standards on file. Without them, they're regular and can't be let go for failing probation." });
  if (sep.rule.taxExempt && sep.amount > 0) checks.push({ ok: true, text: `Separation pay is tax-exempt: separation for a cause beyond the employee's control (NIRC Sec. 32(B)(6)(b)).${reason === "retrenchment" ? " Get the BIR certificate of tax exemption." : ""}` });
  checks.push({ ok: true, text: `Release by ${formatDate(addDays(lastDay, 30))}, within 30 days of the last day, unless company policy or a CBA says sooner (Labor Advisory 06-20). Give the certificate of employment within 3 days of a request, and BIR Form 2316 on the day of separation.` });

  return {
    employee: e, lastDay, reason, lastSlip, lines, deductions, statutoryLoans, taxAdjustment, total, dueBy: addDays(lastDay, 30), checks,
    years: sep.years, age: ret.age, retirement: ret,
  };
}

export { separationLabel };
