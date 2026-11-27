// Loans and advances (docs/loans.md). Same rules as the web app: lib/loans.ts.

import { z } from "zod";
import {
  LOAN_KIND_LIST, buildLoan, buildRequest, decidedLoan, loanSummary, patchedLoan, validateDecision, validateLoan, validateLoanPatch,
  validateLoanRequest, validatePayment, type LoanSummary,
} from "@/lib/loans";
import type { Database, Loan } from "@/lib/types";
import { type Ctx, isPrivileged, requirePrivileged, requireScope, selfId } from "../context";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { isoDate, listQuery, paginate, parse } from "../validate";

const today = (ctx: Ctx) => ctx.now.slice(0, 10);
const kind = z.enum(LOAN_KIND_LIST as [Loan["kind"], ...Loan["kind"][]]);
const timing = z.enum(["split", "first_cutoff", "second_cutoff"]);
const money = z.number().finite();

function out(s: LoanSummary) {
  return {
    ...s.loan, kind_label: s.info.label, agency: s.info.agency, status: s.status, repaid: s.repaid, balance: s.balance, per_cutoff: s.perCutoff,
    next_deduction: s.next ? { period_id: s.next.period.id, pay_date: s.next.period.pay_date, amount: s.next.amount } : null,
    expected_last_deduction: s.lastDeduction?.pay_date ?? null, remaining_cutoffs: s.remainingCutoffs, warning: s.warning,
  };
}

async function load(ctx: Ctx, id: string): Promise<{ db: Database; loan: Loan }> {
  const db = await ctx.repo.snapshot(ctx.orgId);
  const loan = db.loans.find((l) => l.id === id);
  if (!loan) throw notFound("Loan");
  if (loan.employee_id !== selfId(ctx) && !isPrivileged(ctx)) throw notFound("Loan"); // not yours: don't confirm it exists
  return { db, loan };
}

function check(errors: Record<string, string>) {
  if (!Object.keys(errors).length) return;
  if (errors.body && Object.keys(errors).length === 1) throw conflict(errors.body);
  throw invalid(errors);
}

export const ListLoans = listQuery.extend({
  employee_id: z.string().optional(),
  status: z.enum(["requested", "active", "paused", "paid", "stopped", "rejected", "cancelled"]).optional(),
  kind: kind.optional(),
});
export async function listLoans(ctx: Ctx, query: unknown) {
  requireScope(ctx, "payroll:read");
  const q = parse(ListLoans, query);
  const who = q.employee_id ?? (isPrivileged(ctx) ? undefined : selfId(ctx) ?? undefined);
  if (who && who !== selfId(ctx) && !isPrivileged(ctx)) throw forbidden("Loans are private: the person, admin and HR.");
  const db = await ctx.repo.snapshot(ctx.orgId);
  const rows = db.loans.filter((l) => (!who || l.employee_id === who) && (!q.kind || l.kind === q.kind)).map((l) => loanSummary(db, l, today(ctx)))
    .filter((s) => !q.status || s.status === q.status).map(out);
  return paginate(rows, q);
}

export async function getLoan(ctx: Ctx, id: string) {
  requireScope(ctx, "payroll:read");
  const { db, loan } = await load(ctx, id);
  const s = loanSummary(db, loan, today(ctx));
  return { ...out(s), ledger: s.ledger, payments: db.loan_payments.filter((p) => p.loan_id === id) };
}

export const CreateLoan = z.object({
  employee_id: z.string(), kind, reference_no: z.string().max(60).nullable().default(null), purpose: z.string().max(200).nullable().default(null),
  principal: money, paid_before: money.default(0), monthly_amortization: money, schedule: timing.default("split"), first_deduction_on: isoDate,
  authorization: z.string().max(300).nullable().default(null),
}).strict();
export async function createLoan(ctx: Ctx, body: unknown) {
  requirePrivileged(ctx, "payroll:write");
  const input = parse(CreateLoan, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  check(validateLoan(db, input));
  const by = selfId(ctx) ?? "api";
  const loan = await ctx.repo.insert("loans", buildLoan(input, ctx.repo.newId("ln"), ctx.orgId, by, ctx.now));
  return out(loanSummary(await ctx.repo.snapshot(ctx.orgId), loan, today(ctx)));
}

export const UpdateLoan = z.object({
  monthly_amortization: money, schedule: timing, reference_no: z.string().max(60).nullable(), authorization: z.string().max(300).nullable(),
  purpose: z.string().max(200).nullable(), first_deduction_on: isoDate, status: z.enum(["active", "paused", "stopped"]), stop_reason: z.string().max(300).nullable(),
}).partial().strict();
export async function updateLoan(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "payroll:write");
  const patch = parse(UpdateLoan, body);
  const { loan } = await load(ctx, id);
  check(validateLoanPatch(loan, patch));
  await ctx.repo.update("loans", "id", id, patchedLoan(loan, patch));
  return getLoan(ctx, id);
}

export const LoanPaymentBody = z.object({ amount: money, paid_on: isoDate, method: z.enum(["paid_directly", "adjustment"]).default("paid_directly"), note: z.string().max(300).nullable().default(null) }).strict();
export async function addPayment(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "payroll:write");
  const input = parse(LoanPaymentBody, body);
  const { db, loan } = await load(ctx, id);
  check(validatePayment(db, loan, input, today(ctx)));
  await ctx.repo.insert("loan_payments", {
    id: ctx.repo.newId("lp"), loan_id: id, employee_id: loan.employee_id, paid_on: input.paid_on, amount: Math.round(input.amount * 100) / 100,
    method: input.method, note: input.note?.trim() || null, recorded_by: selfId(ctx) ?? "api", recorded_at: ctx.now,
  });
  return getLoan(ctx, id);
}

export const LoanRequestBody = z.object({ kind: z.enum(["cash_advance", "company_loan"]), amount: money, installments: z.number().int(), purpose: z.string().max(200) }).strict();
export async function requestLoan(ctx: Ctx, body: unknown) {
  const me = selfId(ctx);
  if (!me || ctx.principal.kind !== "user") throw forbidden("A person asks for a loan, not an API key.");
  const input = parse(LoanRequestBody, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  check(validateLoanRequest(db, ctx.principal.employee, input, today(ctx)));
  const loan = await ctx.repo.insert("loans", buildRequest(input, ctx.principal.employee, ctx.repo.newId("ln"), ctx.orgId, ctx.now, today(ctx)));
  return out(loanSummary(await ctx.repo.snapshot(ctx.orgId), loan, today(ctx)));
}

export const LoanDecision = z.object({
  approve: z.boolean(), note: z.string().max(500).nullable().optional(), first_deduction_on: isoDate.optional(),
  authorization: z.string().max(300).nullable().optional(), schedule: timing.optional(),
}).strict();
export async function decide(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "payroll:write");
  if (ctx.principal.kind !== "user") throw forbidden("Decisions are made by a person, not an API key.");
  const input = parse(LoanDecision, body);
  const { loan } = await load(ctx, id);
  if (loan.employee_id === ctx.principal.employee.id) throw forbidden("Nobody decides their own request.");
  check(validateDecision(loan, input.approve, input, ctx.principal.employee.id));
  await ctx.repo.update("loans", "id", id, decidedLoan(loan, input, ctx.principal.employee.id, ctx.now));
  return getLoan(ctx, id);
}

export async function cancel(ctx: Ctx, id: string) {
  const { loan } = await load(ctx, id);
  if (loan.employee_id !== selfId(ctx)) throw forbidden("Only the person who asked can withdraw a request.");
  if (loan.status !== "requested") throw conflict("Only a request still waiting can be withdrawn.");
  await ctx.repo.update("loans", "id", id, { status: "cancelled" });
  return getLoan(ctx, id);
}

export async function getSettings(ctx: Ctx) {
  return (await ctx.repo.snapshot(ctx.orgId)).loan_settings;
}
export const LoanSettingsBody = z.object({
  allow_requests: z.boolean(), cash_advance_max_share: z.number().min(0.05).max(1), company_loan_max_months: z.number().min(0.5).max(12),
  max_installments: z.number().int().min(1).max(48), one_open_at_a_time: z.boolean(),
}).partial().strict();
export async function putSettings(ctx: Ctx, body: unknown) {
  requirePrivileged(ctx, "payroll:write");
  return ctx.repo.putSettings(ctx.orgId, "loan_settings", parse(LoanSettingsBody, body));
}
