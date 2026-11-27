import { z } from "zod";
import type { Employee, EmploymentStatusPH, SeparationReason } from "@/lib/types";
import { PROBATION_MAX_DAYS, employmentAlerts, legalStatus, probationEndFor } from "@/lib/employment";
import { finalPay } from "@/lib/finalpay";
import type { Payslip } from "@/lib/payroll";
import { leaveBalance, leaveTypesFor } from "@/lib/leave";
import { buildOnboardingTasks, TEMPLATE_ID } from "@/lib/mock-data";
import { addDays } from "@/lib/format";
import { type Ctx, canSee, isPrivileged, requirePrivileged, requireScope, selfId } from "../context";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { isoDate, listQuery, paginate, parse } from "../validate";

const PUBLIC_FIELDS = [
  "id", "employee_number", "first_name", "last_name", "preferred_name", "pronouns", "work_email", "phone", "job_title",
  "department_id", "location_id", "client_id", "manager_id", "employment_type", "status", "start_date", "end_date", "avatar_url",
] as const;

/** Directory fields for everyone; the full record for the person, admin and HR. */
export function employeeView(ctx: Ctx, e: Employee) {
  if (isPrivileged(ctx) || selfId(ctx) === e.id) return e;
  return Object.fromEntries(PUBLIC_FIELDS.map((k) => [k, e[k]]));
}

const today = (ctx: Ctx) => ctx.now.slice(0, 10);

async function find(ctx: Ctx, id: string) {
  const db = await ctx.repo.snapshot(ctx.orgId);
  const e = db.employees.find((x) => x.id === id);
  if (!e) throw notFound("Employee");
  return { db, e };
}

export async function me(ctx: Ctx) {
  if (ctx.principal.kind === "key") {
    const k = ctx.principal.key;
    return { kind: "api_key", organization_id: ctx.orgId, name: k.name, prefix: k.prefix, scopes: k.scopes };
  }
  const db = await ctx.repo.snapshot(ctx.orgId);
  const e = ctx.principal.employee;
  const reports = db.employees.filter((x) => x.manager_id === e.id && x.status !== "offboarded").map((x) => x.id);
  return { kind: "user", organization_id: ctx.orgId, employee: e, role: e.role, direct_reports: reports, can_manage: isPrivileged(ctx) };
}

export const ListEmployees = listQuery.extend({
  status: z.enum(["active", "onboarding", "on_leave", "offboarded"]).optional(),
  department_id: z.string().optional(),
  location_id: z.string().optional(),
  client_id: z.string().optional(),
  q: z.string().optional(),
});
export async function listEmployees(ctx: Ctx, query: unknown) {
  requireScope(ctx, "employees:read");
  const q = parse(ListEmployees, query);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const needle = q.q?.toLowerCase();
  const rows = db.employees.filter((e) =>
    (!q.status || e.status === q.status) && (!q.department_id || e.department_id === q.department_id) && (!q.location_id || e.location_id === q.location_id) && (!q.client_id || e.client_id === q.client_id) &&
    (!needle || `${e.first_name} ${e.last_name} ${e.preferred_name ?? ""} ${e.job_title} ${e.work_email}`.toLowerCase().includes(needle)));
  const page = paginate(rows, q);
  return { ...page, data: page.data.map((e) => employeeView(ctx, e)) };
}

export async function getEmployee(ctx: Ctx, id: string) {
  requireScope(ctx, "employees:read");
  const { db, e } = await find(ctx, id);
  const view = employeeView(ctx, e);
  if (!isPrivileged(ctx) && selfId(ctx) !== id) return view;
  const legal = legalStatus(e, today(ctx));
  return { ...view, legal_status: legal.status, legal_status_reason: legal.reason, alerts: employmentAlerts(db, today(ctx)).filter((a) => a.employee.id === id).map((a) => ({ severity: a.severity, message: a.message })) };
}

export const CreateEmployee = z.object({
  first_name: z.string().trim().min(1), last_name: z.string().trim().min(1), work_email: z.string().email(),
  job_title: z.string().trim().min(1), department_id: z.string(), location_id: z.string(), manager_id: z.string().nullable().default(null),
  start_date: isoDate, employment_type: z.enum(["full_time", "part_time", "contractor", "intern"]).default("full_time"),
  shift_code_id: z.string().nullable().optional(), client_id: z.string().nullable().default(null),
});
export async function createEmployee(ctx: Ctx, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const input = parse(CreateEmployee, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  if (db.employees.some((e) => e.work_email.toLowerCase() === input.work_email.toLowerCase())) throw invalid({ work_email: "Someone already uses this work email." });
  if (!db.departments.some((d) => d.id === input.department_id)) throw invalid({ department_id: "Unknown department." });
  const loc = db.locations.find((l) => l.id === input.location_id);
  if (!loc) throw invalid({ location_id: "Unknown location." });
  if (input.manager_id && !db.employees.some((e) => e.id === input.manager_id)) throw invalid({ manager_id: "Unknown manager." });
  if (input.client_id && !db.clients.some((c) => c.id === input.client_id && !c.archived_at)) throw invalid({ client_id: "Unknown or archived client." });
  const n = db.employees.length + 1;
  const ph = !!loc.ph_region;
  const id = ctx.repo.newId("e");
  const employee: Employee = {
    ...input, id, organization_id: ctx.orgId, employee_number: `HLD-${String(n).padStart(4, "0")}`, preferred_name: null, pronouns: null, phone: null,
    status: input.start_date > today(ctx) ? "onboarding" : "active", end_date: null, avatar_url: null, role: "employee",
    shift_code_id: input.shift_code_id ?? db.shift_codes.find((s) => s.is_default)?.id ?? null,
    employment_status_ph: ph ? "probationary" : null, probation_end_date: ph ? probationEndFor(input.start_date) : null, standards_given_on: null,
    contract_end_date: null, regularized_on: null, birth_date: null, separation_reason: null, separation_notice_date: null,
  };
  await ctx.repo.insert("employees", employee);
  await ctx.repo.insert("employment_events", { id: ctx.repo.newId("ev"), employee_id: id, effective_date: input.start_date, kind: "hired", job_title: input.job_title, department_id: input.department_id, note: null });
  const caseId = ctx.repo.newId("ob");
  await ctx.repo.insert("onboarding_cases", { id: caseId, employee_id: id, template_id: TEMPLATE_ID, buddy_id: null, status: "in_progress", created_at: today(ctx) });
  for (const t of buildOnboardingTasks(caseId, input.start_date, null)) await ctx.repo.insert("onboarding_tasks", { ...t, id: ctx.repo.newId("task") });
  return employee;
}

export const UpdateEmployee = z.object({
  job_title: z.string().trim().min(1), department_id: z.string(), location_id: z.string(), client_id: z.string().nullable(), manager_id: z.string().nullable(),
  shift_code_id: z.string().nullable(), phone: z.string().nullable(), preferred_name: z.string().nullable(), pronouns: z.string().nullable(),
  employment_status_ph: z.enum(["probationary", "regular", "project", "seasonal", "casual", "fixed_term"]),
  probation_end_date: isoDate.nullable(), standards_given_on: isoDate.nullable(), contract_end_date: isoDate.nullable(), birth_date: isoDate.nullable(),
}).partial().strict();
export async function updateEmployee(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const patch = parse(UpdateEmployee, body);
  const { db, e } = await find(ctx, id);
  const next = { ...e, ...patch };
  if (patch.manager_id === id) throw invalid({ manager_id: "Someone can't be their own manager." });
  if (patch.manager_id && !db.employees.some((x) => x.id === patch.manager_id)) throw invalid({ manager_id: "Unknown manager." });
  if (patch.department_id && !db.departments.some((d) => d.id === patch.department_id)) throw invalid({ department_id: "Unknown department." });
  if (patch.location_id && !db.locations.some((l) => l.id === patch.location_id)) throw invalid({ location_id: "Unknown branch." });
  if (patch.client_id && !db.clients.some((c) => c.id === patch.client_id && !c.archived_at)) throw invalid({ client_id: "Unknown or archived client." });
  if (patch.shift_code_id && !db.shift_codes.some((s) => s.id === patch.shift_code_id && !s.archived_at)) throw invalid({ shift_code_id: "Unknown or archived shift code." });
  if (next.employment_status_ph === "probationary" && next.probation_end_date && next.probation_end_date > probationEndFor(e.start_date)) {
    throw invalid({ probation_end_date: `Probation can't run past ${probationEndFor(e.start_date)}, ${PROBATION_MAX_DAYS} days from the start (Art. 296).` });
  }
  if (["project", "seasonal", "fixed_term"].includes(next.employment_status_ph ?? "") && !next.contract_end_date) {
    throw invalid({ contract_end_date: "Project, seasonal and fixed-term employment needs an end date." });
  }
  const [row] = await ctx.repo.update("employees", "id", id, patch as Partial<Employee>);
  return row;
}

export async function regularize(ctx: Ctx, id: string) {
  requirePrivileged(ctx, "employees:write");
  const { e } = await find(ctx, id);
  const status = e.employment_status_ph as EmploymentStatusPH | null;
  if (!status) throw conflict("Employment terms apply to people in a Philippine office only.");
  if (status === "regular") throw conflict("Already regular.");
  const [row] = await ctx.repo.update("employees", "id", id, { employment_status_ph: "regular", regularized_on: today(ctx), contract_end_date: null });
  await ctx.repo.insert("employment_events", { id: ctx.repo.newId("ev"), employee_id: id, effective_date: today(ctx), kind: "regularized", job_title: e.job_title, department_id: e.department_id, note: "Regularized" });
  return row;
}

const REASONS = ["resignation", "end_of_contract", "failed_probation", "just_cause", "redundancy", "labor_saving", "retrenchment", "closure", "closure_losses", "disease", "retirement", "death"] as const;
export const Separation = z.object({ last_day: isoDate, reason: z.enum(REASONS), notice_date: isoDate.nullable().default(null) });

export async function finalPayPreview(ctx: Ctx, id: string, query: unknown) {
  requirePrivileged(ctx, "payroll:read");
  const { db, e } = await find(ctx, id);
  const q = parse(Separation.partial(), query);
  const lastDay = q.last_day ?? e.end_date;
  const reason = (q.reason ?? e.separation_reason) as SeparationReason | null;
  if (!lastDay || !reason) throw invalid({ last_day: "Pass last_day and reason, or record the separation first." });
  if (lastDay < e.start_date) throw invalid({ last_day: "The last day can't be before the start date." });
  const fp = finalPay(db, e, lastDay, reason, ctx.now, q.notice_date ?? e.separation_notice_date);
  const { employee: _e, lastSlip, ...rest } = fp;
  return { employee_id: id, ...rest, last_cutoff: lastSlip ? serializeSlip(lastSlip) : null };
}

export async function separate(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const input = parse(Separation, body);
  const { e } = await find(ctx, id);
  if (e.end_date) throw conflict(`A last day is already recorded (${e.end_date}).`);
  if (input.last_day < e.start_date) throw invalid({ last_day: "The last day can't be before the start date." });
  const [row] = await ctx.repo.update("employees", "id", id, {
    end_date: input.last_day, separation_reason: input.reason, separation_notice_date: input.notice_date,
    status: input.last_day < today(ctx) ? "offboarded" : e.status,
  });
  await ctx.repo.insert("employment_events", { id: ctx.repo.newId("ev"), employee_id: id, effective_date: input.last_day, kind: "separated", job_title: e.job_title, department_id: e.department_id, note: null });
  return { employee: row, final_pay_due_by: addDays(input.last_day, 30) };
}

export async function leaveBalances(ctx: Ctx, id: string, query: unknown) {
  requireScope(ctx, "leave:read");
  const { year } = parse(z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }), query);
  const { db, e } = await find(ctx, id);
  if (!canSee(ctx, db, id, { manager: true })) throw forbidden();
  const y = year ?? Number(today(ctx).slice(0, 4));
  const asOf = `${y}` === today(ctx).slice(0, 4) ? today(ctx) : `${y}-12-31`;
  return {
    employee_id: id, year: y, as_of: asOf,
    data: leaveTypesFor(db).map((t) => {
      const b = leaveBalance(db, e, t, y, asOf);
      return { leave_type_id: t.id, name: t.name, statutory: t.statutory, accrual: t.accrual, paid: t.paid, granted: b.granted, carried: b.carried, adjusted: b.adjusted, used: b.used, pending: b.pending, available: b.available, eligible_from: b.eligibleFrom };
    }),
  };
}

/** A payslip without the nested rows, for the API. */
export function serializeSlip(s: Payslip) {
  return {
    employee_id: s.employee.id, period_id: s.period.id, period_start: s.period.start_date, period_end: s.period.end_date, pay_date: s.period.pay_date,
    earnings: s.earnings, deductions: s.deductions, additions: s.additions, contributions: s.contributions, other_deductions: s.otherDeductions,
    deferred: s.deferred, employer: s.employer, gross: s.gross, non_taxable: s.nonTaxable, taxable: s.taxable, tax: s.tax, net: s.net,
    minimum_wage_earner: s.mwe, minimum_wage: s.minimumWage, below_minimum: s.belowMinimum, flags: s.flags, pending_requests: s.pendingRequests,
  };
}
