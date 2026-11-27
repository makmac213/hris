// Loans and advances: the ledger, payroll deductions, requests, final pay and the API (docs/loans.md).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { seed, TODAY } from "@/lib/mock-data";
import { computePayslip, periodFor } from "@/lib/payroll";
import { issuePayslips } from "@/lib/payslips";
import { balanceBefore, buildLoan, loanSummary, requestLimit, validateLoan, validateLoanRequest, validatePayment, type LoanInput } from "@/lib/loans";
import { finalPay } from "@/lib/finalpay";
import { runReport, viewerFor, defaultParams } from "@/lib/reports";
import type { Database, Loan, PayrollPeriod } from "@/lib/types";
import { handle } from "@/lib/server/http";
import { resetMemoryRepo } from "@/lib/server/repo";

const NOW = new Date().toISOString();
const open = () => seed.payroll_periods.find((p) => p.status === "open")!;
const emp = (db: Database, id: string) => db.employees.find((e) => e.id === id)!;
const slipOf = (db: Database, id: string, p: PayrollPeriod = open()) => computePayslip(db, emp(db, id), p, NOW)!;
const withLoan = (over: Partial<LoanInput> & { employee_id: string }, extra: Partial<Loan> = {}): { db: Database; loan: Loan } => {
  const input: LoanInput = { kind: "company_loan", reference_no: null, purpose: "Test", principal: 5000, paid_before: 0, monthly_amortization: 2000, schedule: "split", first_deduction_on: open().start_date, authorization: "signed", ...over };
  const loan = { ...buildLoan(input, "ln-test", "org", "e10", NOW), ...extra };
  return { db: { ...seed, loans: [...seed.loans, loan] }, loan };
};
const line = (db: Database, id: string, loanId: string) => slipOf(db, id).otherDeductions.find((l) => l.key === `ded-${loanId}`);

test("an SSS loan is deducted on the payslip, with its reference and balance", () => {
  const l = line(seed, "e16", "ln-sss-e16");
  assert.ok(l, "the open period deducts the SSS loan");
  assert.equal(l!.amount, 1100);
  assert.match(l!.detail ?? "", /authorized by law/);
  assert.match(l!.detail ?? "", /0426-1187-34/);
});

test("the balance counts what was repaid before Halden and what issued payslips took", () => {
  const s = loanSummary(seed, seed.loans.find((l) => l.id === "ln-sss-e16")!, TODAY);
  // ₱52,800 − ₱11,000 before Halden − ₱1,100 on the issued Nov 1–15 payslip
  assert.equal(s.repaid, 12100);
  assert.equal(s.balance, 40700);
  assert.equal(s.next?.amount, 1100);
  assert.equal(s.remainingCutoffs, 37);
});

test("the last deduction takes only what's left, then the loan stops by itself", () => {
  const { db, loan } = withLoan({ employee_id: "e19", principal: 1500 });
  assert.equal(line(db, "e19", loan.id)?.amount, 1000);
  const next = { ...periodFor(addDay(open().end_date)), status: "open" as const, finalized_at: null, finalized_by: null };
  assert.equal(balanceBefore(db, loan, next), 500);
  assert.equal(slipOf(db, "e19", next).otherDeductions.find((l) => l.key === `ded-${loan.id}`)?.amount, 500);
  const s = loanSummary(db, loan, TODAY);
  assert.equal(s.remainingCutoffs, 2);
  assert.equal(s.lastDeduction?.id, next.id);
});

test("what a short cutoff can't cover stays in the balance", () => {
  const { db, loan } = withLoan({ employee_id: "e19", principal: 900000, monthly_amortization: 800000 });
  const s = slipOf(db, "e19");
  const taken = s.otherDeductions.find((l) => l.key === `ded-${loan.id}`)!.amount;
  assert.ok(taken < 400000);
  assert.ok(s.deferred.some((l) => l.key === `def-${loan.id}` && /stays in the loan balance/.test(l.detail ?? "")));
  // Issue the period: the balance goes down by what was actually taken, not the scheduled amount.
  const p = { ...open(), status: "finalized" as const };
  const issued: Database = { ...db, payroll_periods: db.payroll_periods.map((x) => (x.id === p.id ? p : x)), payslips: [...db.payslips, ...issuePayslips(db, p, NOW, "org")] };
  assert.equal(loanSummary(issued, loan, TODAY).balance, Math.round((900000 - taken) * 100) / 100);
});

test("a paused loan isn't deducted; a stopped one neither", () => {
  for (const status of ["paused", "stopped"] as const) {
    const { db, loan } = withLoan({ employee_id: "e19" }, { status, stop_reason: status === "stopped" ? "Written off" : null });
    assert.equal(line(db, "e19", loan.id), undefined, status);
  }
});

test("a company loan without a signed authorization isn't deducted and says why", () => {
  const { db, loan } = withLoan({ employee_id: "e19", authorization: null });
  assert.equal(line(db, "e19", loan.id), undefined);
  assert.ok(slipOf(db, "e19").flags.some((f) => /authorization/.test(f)));
  assert.match(loanSummary(db, loan, TODAY).warning ?? "", /Art\. 113/);
});

test("a loan paid in full outside payroll shows as paid and isn't deducted", () => {
  const s = loanSummary(seed, seed.loans.find((l) => l.id === "ln-adv-e19")!, TODAY);
  assert.equal(s.status, "paid");
  assert.equal(s.balance, 0);
  assert.equal(line(seed, "e19", "ln-adv-e19"), undefined);
});

test("payments outside payroll can't go over the balance, or into the future", () => {
  const loan = seed.loans.find((l) => l.id === "ln-co-e13")!;
  assert.ok(validatePayment(seed, loan, { amount: 999999, paid_on: TODAY, method: "paid_directly" }, TODAY).amount);
  assert.ok(validatePayment(seed, loan, { amount: -100, paid_on: TODAY, method: "paid_directly" }, TODAY).amount);
  assert.deepEqual(validatePayment(seed, loan, { amount: -100, paid_on: TODAY, method: "adjustment" }, TODAY), {});
  assert.ok(validatePayment(seed, loan, { amount: 100, paid_on: "2099-01-01", method: "paid_directly" }, TODAY).paid_on);
});

test("agency loans need the loan number; the amortization can't be more than the loan", () => {
  const base = { employee_id: "e16", principal: 10000, paid_before: 0, monthly_amortization: 500, schedule: "split" as const, first_deduction_on: TODAY, authorization: null, purpose: null };
  assert.ok(validateLoan(seed, { ...base, kind: "sss_salary", reference_no: null }).reference_no);
  assert.ok(validateLoan(seed, { ...base, kind: "company_loan", reference_no: null, monthly_amortization: 20000 }).monthly_amortization);
  assert.ok(validateLoan(seed, { ...base, kind: "company_loan", reference_no: null, paid_before: 10000 }).paid_before);
  assert.deepEqual(validateLoan(seed, { ...base, kind: "company_loan", reference_no: null }), {});
});

test("requests follow company policy: limit, term, one open at a time", () => {
  const e = emp(seed, "e16");
  const max = requestLimit(seed, "e16", "cash_advance");
  assert.ok(max > 0);
  assert.deepEqual(validateLoanRequest(seed, e, { kind: "cash_advance", amount: max, installments: 4, purpose: "Rent" }, TODAY), {});
  assert.ok(validateLoanRequest(seed, e, { kind: "cash_advance", amount: max + 1, installments: 4, purpose: "Rent" }, TODAY).amount);
  assert.ok(validateLoanRequest(seed, e, { kind: "cash_advance", amount: 1000, installments: 13, purpose: "Rent" }, TODAY).installments);
  assert.ok(validateLoanRequest(seed, e, { kind: "sss_salary", amount: 1000, installments: 2, purpose: "Rent" }, TODAY).kind, "agency loans come from the agency");
  assert.ok(validateLoanRequest(seed, emp(seed, "e37"), { kind: "cash_advance", amount: 1000, installments: 2, purpose: "Rent" }, TODAY).kind, "e37 still owes on an advance");
  assert.ok(validateLoanRequest(seed, emp(seed, "e25"), { kind: "cash_advance", amount: 1000, installments: 2, purpose: "Rent" }, TODAY).kind, "e25 has a request waiting");
  const off: Database = { ...seed, loan_settings: { ...seed.loan_settings, allow_requests: false } };
  assert.ok(validateLoanRequest(off, e, { kind: "cash_advance", amount: 1000, installments: 2, purpose: "Rent" }, TODAY).body);
});

test("final pay deducts an authorized company loan's balance and lists agency loans for reporting", () => {
  const fp13 = finalPay(seed, emp(seed, "e13"), "2026-12-15", "resignation", NOW, "2026-11-10");
  const co = fp13.deductions.find((l) => l.key === "bal-ln-co-e13");
  assert.ok(co, "company loan balance is deducted");
  // ₱24,000 − ₱8,000 before Halden − ₱2,000 a cutoff for Nov 1–15, Nov 16–30 and Dec 1–15
  assert.equal(co!.amount, 10000);
  const fp16 = finalPay(seed, emp(seed, "e16"), "2026-12-15", "resignation", NOW, "2026-11-10");
  assert.ok(fp16.statutoryLoans.some((l) => l.key === "bal-ln-sss-e16"));
  assert.ok(!fp16.deductions.some((l) => l.key === "bal-ln-sss-e16"));
});

test("the loan remittance report lists SSS and Pag-IBIG deductions by loan number", () => {
  const params = { ...defaultParams(seed, TODAY), month: open().start_date.slice(0, 7) };
  const r = runReport(seed, "loan-remittances", viewerFor(seed, emp(seed, "e10")), params, NOW);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.result.rows.some((x) => x.agency === "SSS" && x.reference === "0426-1187-34"));
  assert.ok(r.result.rows.some((x) => x.agency === "Pag-IBIG"));
  const denied = runReport(seed, "loan-balances", viewerFor(seed, emp(seed, "e06")), params, NOW);
  assert.equal(denied.ok, false, "managers don't see loans");
});

function addDay(d: string) { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }

// ---- API ----------------------------------------------------------------------------

beforeEach(() => { resetMemoryRepo(); });
async function call(method: string, path: string, as: string, body?: unknown) {
  const res = await handle(new Request(`http://localhost/api/v1${path}`, { method, headers: { authorization: `Bearer dev:${as}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test("API: loans are private to the person, admin and HR", async () => {
  const mine = await call("GET", "/loans", "e16");
  assert.equal(mine.status, 200);
  assert.ok(mine.body.data.every((l: { employee_id: string }) => l.employee_id === "e16"));
  assert.equal(mine.body.data[0].balance, 40700);
  assert.equal((await call("GET", "/loans?employee_id=e13", "e16")).status, 403);
  assert.equal((await call("GET", "/loans/ln-co-e13", "e16")).status, 404);
  assert.equal((await call("GET", "/loans?employee_id=e13", "e08")).status, 403, "e08 manages e13 but can't see loans");
  const hr = await call("GET", "/loans?status=requested", "e10");
  assert.deepEqual(hr.body.data.map((l: { id: string }) => l.id), ["ln-req-e25"]);
  const one = await call("GET", "/loans/ln-adv-e19", "e10");
  assert.equal(one.body.status, "paid");
  assert.equal(one.body.ledger[0].kind, "paid_directly");
});

test("API: ask, approve with the authorization, and payroll starts deducting", async () => {
  const asked = await call("POST", "/loan-requests", "e16", { kind: "cash_advance", amount: 4000, installments: 4, purpose: "Rent" });
  assert.equal(asked.status, 201);
  assert.equal(asked.body.status, "requested");
  const id = asked.body.id;
  assert.equal((await call("POST", `/loans/${id}/decision`, "e06", { approve: true })).status, 403, "a manager doesn't approve company money");
  assert.equal((await call("POST", `/loans/${id}/decision`, "e10", { approve: true, first_deduction_on: TODAY })).status, 422, "needs the authorization");
  const ok = await call("POST", `/loans/${id}/decision`, "e10", { approve: true, first_deduction_on: TODAY, authorization: "Signed form on file" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "active");
  assert.equal(ok.body.per_cutoff, 1000);
  assert.equal((await call("POST", `/loans/${id}/decision`, "e10", { approve: false })).status, 409, "already decided");
  const slips = await call("GET", "/payslips?include_estimate=true", "e16");
  const estimate = slips.body.data.find((s: { estimate: boolean }) => s.estimate);
  assert.ok(estimate.other_deductions.some((l: { key: string; amount: number }) => l.key === `ded-${id}` && l.amount === 1000));
});

test("API: nobody decides their own request; the person can withdraw while it waits", async () => {
  const asked = await call("POST", "/loan-requests", "e10", { kind: "cash_advance", amount: 1000, installments: 2, purpose: "Repairs" });
  assert.equal(asked.status, 201);
  assert.equal((await call("POST", `/loans/${asked.body.id}/decision`, "e10", { approve: true, first_deduction_on: TODAY, authorization: "x" })).status, 403);
  assert.equal((await call("POST", `/loans/${asked.body.id}/cancel`, "e04")).status, 403);
  assert.equal((await call("POST", `/loans/${asked.body.id}/cancel`, "e10")).body.status, "cancelled");
  assert.equal((await call("POST", `/loans/${asked.body.id}/cancel`, "e10")).status, 409);
});

test("API: HR enters a loan, records a payment and pauses it", async () => {
  const bad = await call("POST", "/loans", "e10", { employee_id: "e21", kind: "sss_salary", principal: 20000, monthly_amortization: 900, first_deduction_on: TODAY });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.reference_no);
  assert.equal((await call("POST", "/loans", "e16", { employee_id: "e16", kind: "company_loan", principal: 2000, monthly_amortization: 500, first_deduction_on: TODAY })).status, 403);
  const made = await call("POST", "/loans", "e10", { employee_id: "e21", kind: "sss_calamity", reference_no: "CL-77", principal: 20000, paid_before: 2000, monthly_amortization: 900, first_deduction_on: TODAY });
  assert.equal(made.status, 201);
  assert.equal(made.body.balance, 18000);
  const paid = await call("POST", `/loans/${made.body.id}/payments`, "e10", { amount: 5000, paid_on: TODAY, note: "Paid at SSS branch" });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.balance, 13000);
  assert.equal((await call("POST", `/loans/${made.body.id}/payments`, "e10", { amount: 50000, paid_on: TODAY })).status, 422);
  assert.equal((await call("PATCH", `/loans/${made.body.id}`, "e10", { status: "stopped" })).status, 422, "stopping needs a reason");
  const paused = await call("PATCH", `/loans/${made.body.id}`, "e10", { status: "paused" });
  assert.equal(paused.body.status, "paused");
  assert.equal(paused.body.next_deduction, null);
});

test("API: loan policy is read by anyone and changed by admin and HR", async () => {
  assert.equal((await call("GET", "/loan-settings", "e16")).body.max_installments, 12);
  assert.equal((await call("PATCH", "/loan-settings", "e16", { max_installments: 6 })).status, 403);
  assert.equal((await call("PATCH", "/loan-settings", "e10", { max_installments: 6 })).body.max_installments, 6);
  assert.equal((await call("POST", "/loan-requests", "e16", { kind: "cash_advance", amount: 1000, installments: 8, purpose: "x" })).status, 422);
});
