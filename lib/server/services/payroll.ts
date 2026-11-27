import { z } from "zod";
import { computePayslip } from "@/lib/payroll";
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
  const slips = db.employees.map((e) => computePayslip(db, e, p, ctx.now)).filter((s) => !!s);
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
  const [row] = await ctx.repo.update("payroll_periods", "id", id, { status: "finalized", finalized_at: ctx.now, finalized_by: ctx.principal.employee.id });
  return row;
}

export const ListPayslips = listQuery.extend({ employee_id: z.string().optional(), period_id: z.string().optional() });
export async function payslips(ctx: Ctx, query: unknown) {
  requireScope(ctx, "payroll:read");
  const q = parse(ListPayslips, query);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const who = q.employee_id ?? selfId(ctx);
  if (!who) throw forbidden("Pass employee_id.");
  // Pay is private: the person, admin and HR. Managers don't see their team's pay.
  if (who !== selfId(ctx) && !isPrivileged(ctx)) throw forbidden();
  const emp = db.employees.find((e) => e.id === who);
  if (!emp) throw notFound("Employee");
  const periods = db.payroll_periods.filter((p) => !q.period_id || p.id === q.period_id);
  const slips = periods.map((p) => computePayslip(db, emp, p, ctx.now)).filter((s) => !!s).map((s) => ({ id: `${s.period.id}:${emp.id}`, status: s.period.status, ...serializeSlip(s) }));
  return paginate(slips, q);
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
