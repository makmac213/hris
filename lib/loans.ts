// Loans: SSS and Pag-IBIG salary loans, company loans and cash advances (docs/loans.md).
// A loan has an amount to repay and a ledger. Payroll takes the amortization, or what's left if less,
// and stops at zero. What payroll took comes from the issued payslips, which never change.

import type { ContributionTiming, Database, DeductionCategory, Employee, Loan, LoanKind, LoanPayment, LoanSettings, PayItem, PayrollPeriod } from "./types";
import { addDays, formatDate } from "./format";
import { periodFor, rates } from "./payroll";

export const DEFAULT_LOAN_SETTINGS: LoanSettings = {
  allow_requests: true,
  cash_advance_max_share: 0.5,
  company_loan_max_months: 2,
  max_installments: 12,
  one_open_at_a_time: true,
};

export interface LoanKindInfo {
  label: string;
  agency: "SSS" | "Pag-IBIG" | null;
  category: DeductionCategory;
  needsAuthorization: boolean;
  requestable: boolean; // employees can ask for it
}

export const LOAN_KINDS: Record<LoanKind, LoanKindInfo> = {
  sss_salary: { label: "SSS salary loan", agency: "SSS", category: "sss_loan", needsAuthorization: false, requestable: false },
  sss_calamity: { label: "SSS calamity loan", agency: "SSS", category: "sss_loan", needsAuthorization: false, requestable: false },
  pagibig_multi_purpose: { label: "Pag-IBIG multi-purpose loan", agency: "Pag-IBIG", category: "pagibig_loan", needsAuthorization: false, requestable: false },
  pagibig_calamity: { label: "Pag-IBIG calamity loan", agency: "Pag-IBIG", category: "pagibig_loan", needsAuthorization: false, requestable: false },
  company_loan: { label: "Company loan", agency: null, category: "company_loan", needsAuthorization: true, requestable: true },
  cash_advance: { label: "Cash advance", agency: null, category: "company_loan", needsAuthorization: true, requestable: true },
};
export const LOAN_KIND_LIST = Object.keys(LOAN_KINDS) as LoanKind[];
export const SCHEDULE_LABEL: Record<ContributionTiming, string> = { split: "Half each cutoff", first_cutoff: "1st–15th cutoff", second_cutoff: "16th–end cutoff" };

const r2 = (n: number) => Math.round(n * 100) / 100;
const settingsOf = (db: Database): LoanSettings => ({ ...DEFAULT_LOAN_SETTINGS, ...(db.loan_settings ?? {}) });
export { settingsOf as loanSettings };

/** What the loan takes in a cutoff it applies to. */
export const perCutoff = (loan: Pick<Loan, "monthly_amortization" | "schedule">) => r2(loan.schedule === "split" ? loan.monthly_amortization / 2 : loan.monthly_amortization);

const isSecond = (p: { start_date: string }) => p.start_date.endsWith("-16");
function hits(loan: Loan, p: { start_date: string; end_date: string }) {
  if (p.end_date < loan.first_deduction_on) return false;
  if (loan.schedule === "first_cutoff") return !isSecond(p);
  if (loan.schedule === "second_cutoff") return isSecond(p);
  return true;
}

type Period = Pick<PayrollPeriod, "id" | "start_date" | "end_date" | "pay_date">;
const nextPeriod = (p: Period): Period => periodFor(addDays(p.end_date, 1));

/** What payroll took for this loan on an issued payslip, or null if the period hasn't been issued. */
function takenOnIssued(db: Database, loan: Loan, p: Period): number | null {
  const row = db.payroll_periods.find((x) => x.id === p.id);
  if (!row || row.status === "open") return null;
  const slip = (db.payslips ?? []).find((s) => s.period_id === p.id && s.employee_id === loan.employee_id);
  const lines = (slip?.data as { otherDeductions?: { key: string; amount: number }[] } | undefined)?.otherDeductions ?? [];
  return lines.find((l) => l.key === `ded-${loan.id}`)?.amount ?? 0;
}

const earliestPeriod = (db: Database) => db.payroll_periods.reduce<string | null>((m, p) => (!m || p.start_date < m ? p.start_date : m), null);
const paymentsOf = (db: Database, loan: Loan) => (db.loan_payments ?? []).filter((x) => x.loan_id === loan.id);

/**
 * Balance left when the given period starts. Periods before Halden's first payroll are covered by
 * "repaid before Halden"; issued periods count what was actually taken; later ones assume the scheduled amount.
 */
export function balanceBefore(db: Database, loan: Loan, period: Pick<PayrollPeriod, "start_date" | "end_date">): number {
  let bal = loan.principal - loan.paid_before - paymentsOf(db, loan).filter((x) => x.paid_on <= period.end_date).reduce((n, x) => n + x.amount, 0);
  const first = earliestPeriod(db);
  for (let p: Period = periodFor(loan.first_deduction_on); p.start_date < period.start_date && bal > 0.004; p = nextPeriod(p)) {
    if (!hits(loan, p) || (first && p.start_date < first)) continue;
    const issued = takenOnIssued(db, loan, p);
    bal -= issued ?? (loan.status === "active" ? Math.min(perCutoff(loan), bal) : 0);
  }
  return r2(Math.max(0, bal));
}

/** Loans become deduction items for the payroll engine, with the balance for the payslip detail. */
export function loanItemsFor(db: Database, employee: Employee, period: Pick<PayrollPeriod, "start_date" | "end_date">): { item: PayItem; installment: null; note: string }[] {
  const out: { item: PayItem; installment: null; note: string }[] = [];
  for (const loan of db.loans ?? []) {
    if (loan.employee_id !== employee.id || loan.status !== "active" || !hits(loan, period)) continue;
    const bal = balanceBefore(db, loan, period);
    const amount = r2(Math.min(perCutoff(loan), bal));
    if (amount <= 0) continue;
    const info = LOAN_KINDS[loan.kind];
    out.push({
      installment: null,
      note: `${loan.reference_no ? `ref. ${loan.reference_no} · ` : ""}balance ${pesoPlain(bal)} before this`,
      item: {
        id: loan.id, type_id: null, employee_id: loan.employee_id, direction: "deduction", category: info.category, de_minimis_kind: null,
        label: loan.purpose && !info.agency ? `${info.label}: ${loan.purpose}` : info.label, amount, schedule: "every_cutoff",
        start_date: loan.first_deduction_on, end_date: null, installments: null, authorization: info.needsAuthorization ? loan.authorization : "Authorized by law",
        created_by: loan.created_by, created_at: loan.created_at,
      },
    });
  }
  return out;
}

const pesoPlain = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface LedgerEntry { date: string; kind: "opening" | "payroll" | "paid_directly" | "adjustment"; label: string; amount: number; period_id: string | null; payment_id: string | null }

export interface LoanSummary {
  loan: Loan;
  info: LoanKindInfo;
  status: Loan["status"] | "paid";
  repaid: number;
  balance: number;
  perCutoff: number;
  ledger: LedgerEntry[]; // newest first
  next: { period: Period; amount: number; estimate: boolean } | null;
  lastDeduction: Period | null; // expected, if nothing changes
  remainingCutoffs: number;
  warning: string | null;
}

/** The loan as of a date: what's been repaid, the balance, the ledger and what comes next. */
export function loanSummary(db: Database, loan: Loan, today: string): LoanSummary {
  const info = LOAN_KINDS[loan.kind];
  const ledger: LedgerEntry[] = [];
  if (loan.paid_before > 0) ledger.push({ date: loan.created_at.slice(0, 10), kind: "opening", label: "Repaid before Halden", amount: loan.paid_before, period_id: null, payment_id: null });
  for (const p of db.payroll_periods) {
    const taken = takenOnIssued(db, loan, p);
    if (taken) ledger.push({ date: p.pay_date, kind: "payroll", label: `Payroll deduction, ${formatDate(p.start_date).replace(/, \d{4}$/, "")} – ${formatDate(p.end_date)}`, amount: taken, period_id: p.id, payment_id: null });
  }
  for (const x of paymentsOf(db, loan)) ledger.push({ date: x.paid_on, kind: x.method, label: x.note ?? (x.method === "paid_directly" ? "Paid directly" : "Adjustment"), amount: x.amount, period_id: null, payment_id: x.id });
  ledger.sort((a, b) => b.date.localeCompare(a.date));
  const repaid = r2(ledger.reduce((n, l) => n + l.amount, 0));
  const balance = r2(Math.max(0, loan.principal - repaid));
  const live = loan.status === "active" || loan.status === "paused";
  const status = live && balance <= 0.004 ? "paid" : loan.status;

  let next: LoanSummary["next"] = null, lastDeduction: Period | null = null, remainingCutoffs = 0;
  if (loan.status === "active" && balance > 0.004) {
    const open = db.payroll_periods.find((p) => p.status === "open");
    let p: Period = open ?? periodFor(today);
    if (p.end_date < loan.first_deduction_on) p = periodFor(loan.first_deduction_on);
    for (let i = 0; i < 240; i++, p = nextPeriod(p)) {
      if (!hits(loan, p)) continue;
      const bal = balanceBefore(db, loan, p);
      if (bal <= 0.004) break;
      const amount = r2(Math.min(perCutoff(loan), bal));
      if (!next) next = { period: p, amount, estimate: true };
      lastDeduction = p;
      remainingCutoffs++;
    }
  }
  const warning = info.needsAuthorization && !loan.authorization && live ? "No signed authorization on file, so payroll won't deduct it (Art. 113)." : null;
  return { loan, info, status, repaid, balance, perCutoff: perCutoff(loan), ledger, next, lastDeduction, remainingCutoffs, warning };
}

// ---- Requests --------------------------------------------------------------------------

export interface LoanRequestInput { kind: LoanKind; amount: number; installments: number; purpose: string }

export function monthlyBasic(db: Database, employeeId: string): number | null {
  const comp = db.compensation.find((c) => c.employee_id === employeeId && c.on_ph_payroll);
  if (!comp) return null;
  const e = db.employees.find((x) => x.id === employeeId);
  const shift = db.shift_codes.find((s) => s.id === e?.shift_code_id);
  return r2(rates(comp, shift, db.payroll_settings).monthly);
}

/** The most an employee can ask for, under company policy. */
export function requestLimit(db: Database, employeeId: string, kind: LoanKind): number {
  const s = settingsOf(db);
  const basic = monthlyBasic(db, employeeId) ?? 0;
  return r2(kind === "cash_advance" ? basic * s.cash_advance_max_share : basic * s.company_loan_max_months);
}

/** Company loans, advances and requests that still count as open. */
export function openCompanyLoans(db: Database, employeeId: string, today: string) {
  return (db.loans ?? []).filter((l) => l.employee_id === employeeId && LOAN_KINDS[l.kind].requestable && (l.status === "requested" || ((l.status === "active" || l.status === "paused") && loanSummary(db, l, today).balance > 0)));
}

/** Checks an employee's request against company policy. Field errors, or an empty object. */
export function validateLoanRequest(db: Database, employee: Employee, input: Partial<LoanRequestInput>, today: string): Record<string, string> {
  const s = settingsOf(db);
  const e: Record<string, string> = {};
  if (!s.allow_requests) return { body: "Halden isn't taking loan or advance requests through the app. Talk to HR." };
  if (!monthlyBasic(db, employee.id)) return { body: "Loans and advances are for people on the Philippine payroll." };
  if (employee.end_date) return { body: "You have a last day on record, so you can't ask for a loan or advance." };
  if (!input.kind || !LOAN_KINDS[input.kind]?.requestable) e.kind = "Choose a cash advance or a company loan.";
  if (s.one_open_at_a_time && openCompanyLoans(db, employee.id, today).length) e.kind = "You already have a loan, advance or request open. Pay it off or withdraw the request first.";
  const amt = Number(input.amount);
  if (!Number.isFinite(amt) || amt <= 0) e.amount = "Enter the amount in pesos.";
  else if (input.kind && LOAN_KINDS[input.kind]?.requestable) {
    const max = requestLimit(db, employee.id, input.kind);
    if (amt > max + 0.004) e.amount = `The most you can ask for is ${pesoPlain(max)} (${input.kind === "cash_advance" ? `${Math.round(s.cash_advance_max_share * 100)}% of your monthly basic pay` : `${s.company_loan_max_months} months of basic pay`}).`;
  }
  const n = Number(input.installments);
  if (!Number.isInteger(n) || n < 1) e.installments = "Use a whole number of cutoffs.";
  else if (n > s.max_installments) e.installments = `Repay within ${s.max_installments} cutoffs.`;
  if (!input.purpose?.trim()) e.purpose = "Say briefly what it's for.";
  return e;
}

/** Per-cutoff deduction for a request, rounded up to the centavo so it's repaid in the number of cutoffs asked. */
export const installmentAmount = (amount: number, installments: number) => Math.ceil((amount / installments) * 100) / 100;

export function buildRequest(input: LoanRequestInput, employee: Employee, id: string, orgId: string, nowIso: string, today: string): Loan {
  const per = installmentAmount(input.amount, input.installments);
  return {
    id, organization_id: orgId, employee_id: employee.id, kind: input.kind, reference_no: null, purpose: input.purpose.trim(),
    principal: r2(input.amount), paid_before: 0, monthly_amortization: r2(per * 2), schedule: "split", first_deduction_on: today,
    authorization: null, status: "requested", stop_reason: null, requested_at: nowIso, requested_installments: input.installments,
    decided_by: null, decided_at: null, decision_note: null, created_by: employee.id, created_at: nowIso,
  };
}

// ---- Loans entered by HR ----------------------------------------------------------------

export interface LoanInput {
  employee_id: string; kind: LoanKind; reference_no: string | null; purpose: string | null; principal: number; paid_before: number;
  monthly_amortization: number; schedule: ContributionTiming; first_deduction_on: string; authorization: string | null;
}

export function validateLoan(db: Database, input: Partial<LoanInput>): Record<string, string> {
  const e: Record<string, string> = {};
  const emp = db.employees.find((x) => x.id === input.employee_id);
  if (!emp) e.employee_id = "Choose who the loan is for.";
  else if (!monthlyBasic(db, emp.id)) e.employee_id = "Loans are deducted through the Philippine payroll, and this person isn't on it.";
  if (!input.kind || !LOAN_KINDS[input.kind]) e.kind = "Choose the kind of loan.";
  const p = Number(input.principal), before = Number(input.paid_before ?? 0), m = Number(input.monthly_amortization);
  if (!Number.isFinite(p) || p <= 0) e.principal = "Enter the amount to repay.";
  if (!Number.isFinite(before) || before < 0) e.paid_before = "Enter 0 or more.";
  else if (Number.isFinite(p) && before >= p) e.paid_before = "That's the whole loan. Leave it out if it's already paid.";
  if (!Number.isFinite(m) || m <= 0) e.monthly_amortization = "Enter the monthly amortization.";
  else if (Number.isFinite(p) && m > p) e.monthly_amortization = "The amortization can't be more than the amount to repay.";
  if (!input.first_deduction_on || !/^\d{4}-\d{2}-\d{2}$/.test(input.first_deduction_on)) e.first_deduction_on = "Choose the date of the first deduction.";
  if (input.schedule && !["split", "first_cutoff", "second_cutoff"].includes(input.schedule)) e.schedule = "Choose when to deduct.";
  if (input.kind && LOAN_KINDS[input.kind]?.agency && !input.reference_no?.trim()) e.reference_no = `Enter the ${LOAN_KINDS[input.kind].agency} loan number from the billing, for remittance.`;
  return e;
}

export function buildLoan(input: LoanInput, id: string, orgId: string, byId: string, nowIso: string): Loan {
  return {
    id, organization_id: orgId, employee_id: input.employee_id, kind: input.kind, reference_no: input.reference_no?.trim() || null, purpose: input.purpose?.trim() || null,
    principal: r2(input.principal), paid_before: r2(input.paid_before ?? 0), monthly_amortization: r2(input.monthly_amortization), schedule: input.schedule ?? "split",
    first_deduction_on: input.first_deduction_on, authorization: input.authorization?.trim() || null, status: "active", stop_reason: null,
    requested_at: null, requested_installments: null, decided_by: null, decided_at: null, decision_note: null, created_by: byId, created_at: nowIso,
  };
}

/** Approving a request: payroll starts deducting from the first period ending on or after `first_deduction_on`. */
export function validateDecision(loan: Loan, approve: boolean, input: { first_deduction_on?: string; authorization?: string | null }, deciderId: string): Record<string, string> {
  if (loan.status !== "requested") return { body: "This request has already been decided or withdrawn." };
  if (loan.employee_id === deciderId) return { body: "You can't decide your own request." };
  if (!approve) return {};
  const e: Record<string, string> = {};
  if (!input.first_deduction_on || !/^\d{4}-\d{2}-\d{2}$/.test(input.first_deduction_on)) e.first_deduction_on = "Choose when deductions start.";
  if (LOAN_KINDS[loan.kind].needsAuthorization && !input.authorization?.trim()) e.authorization = "Note the employee's signed authorization. Without it payroll can't deduct (Art. 113).";
  return e;
}

/** A payment outside payroll can't take the balance below zero. */
export function validatePayment(db: Database, loan: Loan, input: Partial<Pick<LoanPayment, "amount" | "paid_on" | "method">>, today: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (loan.status === "requested" || loan.status === "rejected" || loan.status === "cancelled") return { body: "Payments can only be recorded on a loan that was released." };
  const amt = Number(input.amount);
  const bal = loanSummary(db, loan, today).balance;
  if (!Number.isFinite(amt) || amt === 0) e.amount = "Enter the amount.";
  else if (amt < 0 && input.method !== "adjustment") e.amount = "Only an adjustment can be negative.";
  else if (amt > bal + 0.004) e.amount = `The balance is ${pesoPlain(bal)}. A payment can't be more than that.`;
  if (!input.paid_on || !/^\d{4}-\d{2}-\d{2}$/.test(input.paid_on)) e.paid_on = "Choose the date it was paid.";
  else if (input.paid_on > today) e.paid_on = "Record payments once they're made.";
  if (input.method && !["paid_directly", "adjustment"].includes(input.method)) e.method = "Choose paid directly or adjustment.";
  return e;
}

/** Remaining balances for final pay (lib/finalpay.ts). */
export function loanBalancesOn(db: Database, employee: Employee, today: string) {
  return (db.loans ?? [])
    .filter((l) => l.employee_id === employee.id && (l.status === "active" || l.status === "paused"))
    .map((l) => loanSummary(db, l, today))
    .filter((s) => s.balance > 0.004);
}

export interface DecisionInput { approve: boolean; note?: string | null; first_deduction_on?: string; authorization?: string | null; schedule?: ContributionTiming }

/** The request, decided. An approved request is paid down over the cutoffs the employee asked for. */
export function decidedLoan(loan: Loan, input: DecisionInput, deciderId: string, nowIso: string): Loan {
  const decided = { decided_by: deciderId, decided_at: nowIso, decision_note: input.note?.trim() || null };
  if (!input.approve) return { ...loan, ...decided, status: "rejected" };
  const schedule = input.schedule ?? "split";
  const per = installmentAmount(loan.principal, loan.requested_installments ?? 1);
  return {
    ...loan, ...decided, status: "active", schedule, monthly_amortization: r2(schedule === "split" ? per * 2 : per),
    first_deduction_on: input.first_deduction_on!, authorization: input.authorization?.trim() || null,
  };
}

export type LoanPatch = Partial<Pick<Loan, "monthly_amortization" | "schedule" | "reference_no" | "authorization" | "purpose" | "first_deduction_on">> & { status?: "active" | "paused" | "stopped"; stop_reason?: string | null };

export function validateLoanPatch(loan: Loan, patch: LoanPatch): Record<string, string> {
  const e: Record<string, string> = {};
  if (["requested", "rejected", "cancelled"].includes(loan.status)) return { body: "Only a released loan can be changed. Decide the request first." };
  if (loan.status === "stopped" && patch.status !== "active") return { body: "This loan was stopped. Resume it first." };
  if (patch.monthly_amortization !== undefined && (!Number.isFinite(patch.monthly_amortization) || patch.monthly_amortization <= 0)) e.monthly_amortization = "Enter the monthly amortization.";
  if (patch.schedule !== undefined && !["split", "first_cutoff", "second_cutoff"].includes(patch.schedule)) e.schedule = "Choose when to deduct.";
  if (patch.status === "stopped" && !patch.stop_reason?.trim()) e.stop_reason = "Say why it's stopped, for example settled in final pay or written off.";
  if (patch.first_deduction_on !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.first_deduction_on)) e.first_deduction_on = "Use a date like 2026-12-01.";
  return e;
}

export function patchedLoan(loan: Loan, patch: LoanPatch): Loan {
  const next: Loan = { ...loan, ...patch } as Loan;
  if (patch.status && patch.status !== "stopped") next.stop_reason = null;
  if (patch.stop_reason !== undefined && patch.status === "stopped") next.stop_reason = patch.stop_reason?.trim() || null;
  if (patch.monthly_amortization !== undefined) next.monthly_amortization = r2(patch.monthly_amortization);
  for (const k of ["reference_no", "authorization", "purpose"] as const) if (patch[k] !== undefined) next[k] = patch[k]?.trim() || null;
  return next;
}
