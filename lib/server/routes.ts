// The /api/v1 route table. Each route is a thin wrapper over a service; the OpenAPI spec is built from this table.

import type { ZodTypeAny } from "zod";
import type { Ctx } from "./context";
import * as emp from "./services/employees";
import * as time from "./services/time";
import * as req from "./services/requests";
import * as pay from "./services/payroll";

type Params = Record<string, string>;
export interface Route {
  method: "GET" | "POST" | "PATCH";
  path: string; // e.g. /employees/{id}
  summary: string;
  tag: string;
  who: string;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  created?: boolean; // 201 on success
  run: (ctx: Ctx, p: Params, query: Record<string, string>, body: unknown) => Promise<unknown>;
}

const requestRoutes = (kind: "overtime" | "correction" | "leave", plural: string, fileSchema: ZodTypeAny, file: (ctx: Ctx, b: unknown) => Promise<unknown>, label: string): Route[] => [
  { method: "GET", path: `/${plural}`, tag: "Requests", summary: `List ${label} requests`, who: "Own requests by default; scope=to_decide for an approver's queue", query: req.ListRequests, run: (c, _p, q) => req.listRequests(c, kind, q) },
  { method: "POST", path: `/${plural}`, tag: "Requests", summary: `File a ${label} request`, who: "The person", body: fileSchema, created: true, run: (c, _p, _q, b) => file(c, b) },
  { method: "POST", path: `/${plural}/{id}/decision`, tag: "Requests", summary: `Approve or reject a ${label} request`, who: "Their manager, admin or HR; never self", body: req.Decision, run: (c, p, _q, b) => req.decide(c, kind, p.id, b) },
  { method: "POST", path: `/${plural}/{id}/cancel`, tag: "Requests", summary: `Withdraw a pending ${label} request`, who: "The person who filed it", run: (c, p) => req.cancel(c, kind, p.id) },
];

export const ROUTES: Route[] = [
  { method: "GET", path: "/me", tag: "People", summary: "The caller: employee and role, or API key and scopes", who: "Anyone", run: (c) => emp.me(c) },
  { method: "GET", path: "/employees", tag: "People", summary: "List employees", who: "Anyone (directory fields); admin and HR see everything", query: emp.ListEmployees, run: (c, _p, q) => emp.listEmployees(c, q) },
  { method: "POST", path: "/employees", tag: "People", summary: "Hire: create an employee, onboarding and probation terms", who: "Admin, HR", body: emp.CreateEmployee, created: true, run: (c, _p, _q, b) => emp.createEmployee(c, b) },
  { method: "GET", path: "/employees/{id}", tag: "People", summary: "One employee, with legal status and alerts for admin and HR", who: "Anyone; private fields for self, admin and HR", run: (c, p) => emp.getEmployee(c, p.id) },
  { method: "PATCH", path: "/employees/{id}", tag: "People", summary: "Update job, manager, shift and employment terms", who: "Admin, HR", body: emp.UpdateEmployee, run: (c, p, _q, b) => emp.updateEmployee(c, p.id, b) },
  { method: "POST", path: "/employees/{id}/regularize", tag: "People", summary: "Make a probationary or contract employee regular", who: "Admin, HR", run: (c, p) => emp.regularize(c, p.id) },
  { method: "POST", path: "/employees/{id}/separation", tag: "People", summary: "Record the last day and reason for leaving", who: "Admin, HR", body: emp.Separation, run: (c, p, _q, b) => emp.separate(c, p.id, b) },
  { method: "GET", path: "/employees/{id}/final-pay", tag: "Payroll", summary: "Final pay statement; pass last_day and reason to preview", who: "Admin, HR", query: emp.Separation.partial(), run: (c, p, q) => emp.finalPayPreview(c, p.id, q) },
  { method: "GET", path: "/employees/{id}/leave-balances", tag: "Leave", summary: "Leave balances for a year", who: "Self, manager, admin, HR", run: (c, p, q) => emp.leaveBalances(c, p.id, q) },
  { method: "GET", path: "/shift-codes", tag: "Time", summary: "Active shift codes", who: "Anyone", run: (c) => pay.shiftCodes(c) },
  { method: "GET", path: "/time-records", tag: "Time", summary: "Time records", who: "Self, manager (team), admin, HR", query: time.ListTimeRecords, run: (c, _p, q) => time.listTimeRecords(c, q) },
  { method: "POST", path: "/time-records", tag: "Time", summary: "Record a time in or out (server time; photo and GPS required)", who: "The person; devices with an API key (time:write)", body: time.CreateTimeRecord, created: true, run: (c, _p, _q, b) => time.createTimeRecord(c, b) },
  ...requestRoutes("overtime", "overtime-requests", req.FileOvertime, req.fileOvertime, "overtime"),
  ...requestRoutes("correction", "correction-requests", req.FileCorrection, req.fileCorrection, "time correction"),
  { method: "GET", path: "/leave-types", tag: "Leave", summary: "Leave policies, statutory and company", who: "Anyone", run: (c) => pay.leaveTypes(c) },
  ...requestRoutes("leave", "leave-requests", req.FileLeave, req.fileLeave, "leave"),
  { method: "GET", path: "/payroll-periods", tag: "Payroll", summary: "Payroll periods", who: "Admin, HR", run: (c) => pay.listPeriods(c) },
  { method: "GET", path: "/payroll-periods/{id}/payslips", tag: "Payroll", summary: "The payroll register for a period", who: "Admin, HR", run: (c, p) => pay.register(c, p.id) },
  { method: "POST", path: "/payroll-periods/{id}/finalize", tag: "Payroll", summary: "Lock a period after its cutoff", who: "Admin, HR (a person)", run: (c, p) => pay.finalize(c, p.id) },
  { method: "GET", path: "/payslips", tag: "Payroll", summary: "Payslips: your own, or anyone's for admin and HR", who: "Self, admin, HR", query: pay.ListPayslips, run: (c, _p, q) => pay.payslips(c, q) },
  { method: "GET", path: "/year-end/{year}", tag: "Payroll", summary: "Annualization and BIR 2316 figures", who: "Admin, HR", run: (c, p) => pay.yearEnd(c, p.year) },
];

/** Matches a method and path against the table. */
export function match(method: string, path: string): { route: Route; params: Params } | { allowed: string[] } | null {
  const parts = path.split("/").filter(Boolean);
  const allowed: string[] = [];
  for (const route of ROUTES) {
    const rp = route.path.split("/").filter(Boolean);
    if (rp.length !== parts.length) continue;
    const params: Params = {};
    const ok = rp.every((seg, i) => {
      const m = seg.match(/^\{(.+)\}$/);
      if (m) { params[m[1]] = decodeURIComponent(parts[i]); return true; }
      return seg === parts[i];
    });
    if (!ok) continue;
    if (route.method === method) return { route, params };
    allowed.push(route.method);
  }
  return allowed.length ? { allowed } : null;
}
