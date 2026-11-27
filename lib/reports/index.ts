// The report registry: what exists, who may run it, default filters, and one entry point for the web app and the API.

import type { Database, Employee } from "../types";
import { addDays } from "../format";
import { HR_REPORTS } from "./hr";
import { PAYROLL_REPORTS, latestClosed } from "./payroll";
import { AUDIT_REPORTS } from "./audit";
import { executive } from "./executive";
import type { Access, Category, GroupBy, ReportDef, ReportParams, ReportResult, Viewer } from "./types";

export * from "./types";
export const REPORTS: ReportDef[] = [executive, ...HR_REPORTS, ...PAYROLL_REPORTS, ...AUDIT_REPORTS];
export const CATEGORY_LABEL: Record<Category, string> = { executive: "Executive", hr: "HR", payroll: "Payroll and statutory", audit: "Audit" };

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key);

export function viewerFor(db: Database, employee: Employee | null, kind: "user" | "key" = "user"): Viewer {
  if (kind === "key" || !employee) return { kind: "key", role: null, employee: null, isManager: false };
  return { kind: "user", role: employee.role, employee, isManager: db.employees.some((e) => e.manager_id === employee.id && e.status !== "offboarded") };
}

export const availableReports = (v: Viewer) => REPORTS.filter((r) => r.access(v));

export function defaultParams(db: Database, today: string): ReportParams {
  const closed = latestClosed(db);
  return {
    from: addDays(today, -30), to: today, as_of: today, period_id: closed?.id,
    month: (closed ?? { start_date: today }).start_date.slice(0, 7), year: Number(today.slice(0, 4)), group_by: "department",
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Query parameters (from a URL or the API) on top of the defaults. Bad values are ignored, not trusted. */
export function parseParams(db: Database, today: string, q: Record<string, string | undefined>): ReportParams {
  const p = defaultParams(db, today);
  if (q.from && ISO.test(q.from)) p.from = q.from;
  if (q.to && ISO.test(q.to)) p.to = q.to;
  if (p.to < p.from) [p.from, p.to] = [p.to, p.from];
  if (q.as_of && ISO.test(q.as_of)) p.as_of = q.as_of;
  if (q.period_id && db.payroll_periods.some((x) => x.id === q.period_id)) p.period_id = q.period_id;
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) p.month = q.month;
  if (q.year && /^\d{4}$/.test(q.year)) p.year = Number(q.year);
  for (const k of ["department_id", "location_id", "client_id"] as const) if (q[k]) p[k] = q[k];
  if (q.group_by && ["department", "branch", "client"].includes(q.group_by)) p.group_by = q.group_by as GroupBy;
  if (q.q) p.q = q.q.slice(0, 100);
  return p;
}

export type RunOutcome = { ok: true; report: ReportDef; result: ReportResult; params: ReportParams; access: Access } | { ok: false; status: 403 | 404; message: string };

export function runReport(db: Database, key: string, viewer: Viewer, params: ReportParams, nowIso: string): RunOutcome {
  const report = reportByKey(key);
  if (!report) return { ok: false, status: 404, message: "No such report." };
  const access = report.access(viewer);
  if (!access) return { ok: false, status: 403, message: "You can't see this report." };
  const me = viewer.employee?.id;
  const scope = access === "team" ? (e: Employee) => e.manager_id === me : () => true;
  return { ok: true, report, access, params, result: report.run(db, params, scope, nowIso) };
}
