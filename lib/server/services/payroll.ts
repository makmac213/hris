import { z } from "zod";
import { computePayslip, type Payslip } from "@/lib/payroll";
import { issuePayslips, payslipId, payslipsOf, slipFor } from "@/lib/payslips";
import { annualSummary, yearEndDeadlines } from "@/lib/yearend";
import { type Ctx, isPrivileged, requirePrivileged, requireScope, selfId } from "../context";
import { conflict, forbidden, notFound } from "../errors";
import { listQuery, paginate, parse } from "../validate";
import { serializeSlip } from "./employees";

export async function listPeriods(ctx: Ctx) {
  requirePrivileged(ctx, "payroll:read");
  const db = await ctx.repo.snapshot(ctx.orgId);
  return { data: [...db.payroll_periods].sort((a, b) => b.start_date.localeCompare(a.start_date)) };
}

async function period(ctx: Ctx, id: string) {
  const db = await ctx.repo.snapshot(ctx.orgId);
  const p = db.payroll_periods.find((x) => x.id === id);
  if (!p) throw notFound("Payroll period");
  return { db, p };
}

export async function register(ctx: Ctx, id: string) {
  requirePrivileged(ctx, "payroll:read");
  const { db, p } = await period(ctx, id);
  const slips = db.employees.map((e) => slipFor(db, e, p, ctx.now)).filter((s) => !!s);
  const sum = (f: (s: (typeof slips)[number]) => number) => Math.round(slips.reduce((n, s) => n + f(s), 0) * 100) / 100;
  return { period: p, totals: { gross: sum((s) => s.gross), tax: sum((s) => s.tax), net: sum((s) => s.net) }, data: slips.map(serializeSlip) };
}

export async function finalize(ctx: Ctx, id: string) {
  requirePrivileged(ctx, "payroll:write");
  if (ctx.principal.kind !== "user") throw forbidden("Finalizing payroll needs a person, not an API key.");
  const { db, p } = await period(ctx, id);
  if (p.status !== "open") throw conflict(`This period is already ${p.status}.`);
  if (ctx.now.slice(0, 10) <= p.end_date) throw conflict(`You can finalize after the cutoff on ${p.end_date}.`);
  const inPeriod = (d: string) => d >= p.start_date && d <= p.end_date;
  const pending = [...db.overtime_requests, ...db.correction_requests].filter((r) => r.status === "pending" && inPeriod(r.work_date)).length
    + db.leave_requests.filter((r) => r.status === "pending" && (inPeriod(r.start_date) || inPeriod(r.end_date))).length;
  if (pending) throw conflict(`${pending} request${pending > 1 ? "s are" : " is"} still pending in this period.`);
  const below = db.employees.map((e) => computePayslip(db, e, p, ctx.now)).filter((s) => s?.belowMinimum);
  if (below.length) throw conflict(`${below.length} ${below.length > 1 ? "people are" : "person is"} paid below the minimum wage.`);
  // Postgres: one transaction for the period and its payslips.
  const [row] = await ctx.repo.update("payroll_periods", "id", id, { status: "finalized", finalized_at: ctx.now, finalized_by: ctx.principal.employee.id });
  const issued = await ctx.repo.upsert("payslips", issuePayslips(db, p, ctx.now, ctx.orgId));
  return { ...row, payslips_issued: issued.length };
}

export const ListPayslips = listQuery.extend({
  employee_id: z.string().optional(),
  period_id: z.string().optional(),
  include_estimate: z.enum(["true", "false"]).default("false"),
});
const payslipOut = (s: Payslip) => ({ id: payslipId(s.period.id, s.employee.id), status: s.period.status, estimate: s.period.status === "open", ...serializeSlip(s) });

/** Who may read this person's pay: themselves, admin and HR. Managers don't see their team's pay. */
function payOwner(ctx: Ctx, employeeId: string | undefined) {
  const who = employeeId ?? selfId(ctx);
  if (!who) throw forbidden("Pass employee_id.");
  if (who !== selfId(ctx) && !isPrivileged(ctx)) throw forbidden();
  return who;
}

export async function payslips(ctx: Ctx, query: unknown) {
  requireScope(ctx, "payroll:read");
  const q = parse(ListPayslips, query);
  const who = payOwner(ctx, q.employee_id);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const emp = db.employees.find((e) => e.id === who);
  if (!emp) throw notFound("Employee");
  const { issued, estimate } = payslipsOf(db, emp, ctx.now);
  const all = q.include_estimate === "true" && estimate ? [estimate, ...issued] : issued;
  return paginate(all.filter((s) => !q.period_id || s.period.id === q.period_id).map(payslipOut), q);
}

export async function payslip(ctx: Ctx, id: string) {
  requireScope(ctx, "payroll:read");
  const [periodId, employeeId] = id.split(":");
  if (!periodId || !employeeId) throw notFound("Payslip");
  payOwner(ctx, employeeId);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const emp = db.employees.find((e) => e.id === employeeId);
  const p = db.payroll_periods.find((x) => x.id === periodId);
  const s = emp && p ? slipFor(db, emp, p, ctx.now) : null;
  if (!s) throw notFound("Payslip");
  return { ...payslipOut(s), days: s.days.filter((d) => d.scheduledMin || d.otMin || d.holiday) };
}

export async function yearEnd(ctx: Ctx, year: string) {
  requirePrivileged(ctx, "payroll:read");
  const y = parse(z.coerce.number().int().min(2000).max(2100), year);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const rows = db.employees.map((e) => annualSummary(db, e, y, ctx.now)).filter((x) => !!x);
  return {
    year: y, deadlines: yearEndDeadlines(y),
    data: rows.map((r) => ({
      employee_id: r.employee.id, gross: r.gross, non_taxable: r.nonTaxable, mandatory_contributions: r.mandatory, taxable: r.taxable,
      tax_due: r.taxDue, tax_withheld: r.taxWithheld, december_adjustment: r.decemberAdjustment, estimated: r.estimated,
      minimum_wage_earner: r.mwe, substituted_filing: r.substitutedFiling, months: r.months,
    })),
  };
}

export async function shiftCodes(ctx: Ctx) {
  const db = await ctx.repo.snapshot(ctx.orgId);
  return { data: db.shift_codes.filter((s) => !s.archived_at) };
}

export async function leaveTypes(ctx: Ctx) {
  requireScope(ctx, "leave:read");
  const db = await ctx.repo.snapshot(ctx.orgId);
  return { data: db.leave_types.filter((t) => t.active) };
}
