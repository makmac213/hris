// The /api/v1 route table. Each route is a thin wrapper over a service; the OpenAPI spec is built from this table.

import type { ZodTypeAny } from "zod";
import type { Ctx } from "./context";
import * as emp from "./services/employees";
import * as time from "./services/time";
import * as req from "./services/requests";
import * as pay from "./services/payroll";
import * as org from "./services/org";
import * as sched from "./services/schedule";

type Params = Record<string, string>;
export interface Route {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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
  { method: "POST", path: `/${plural}/{id}/decision`, tag: "Requests", summary: `Approve or reject a ${label} request`, who: "Their direct supervisor, or an approver role (admin always; HR and operations if turned on); never self", body: req.Decision, run: (c, p, _q, b) => req.decide(c, kind, p.id, b) },
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
  { method: "GET", path: "/departments", tag: "Organization", summary: "Departments, with headcount", who: "Anyone", run: (c) => org.listDepartments(c) },
  { method: "POST", path: "/departments", tag: "Organization", summary: "Add a department", who: "Admin, HR", body: org.SaveDepartment, created: true, run: (c, _p, _q, b) => org.createDepartment(c, b) },
  { method: "PATCH", path: "/departments/{id}", tag: "Organization", summary: "Rename a department or change its head", who: "Admin, HR", body: org.SaveDepartment.partial(), run: (c, p, _q, b) => org.updateDepartment(c, p.id, b) },
  { method: "DELETE", path: "/departments/{id}", tag: "Organization", summary: "Delete an empty department", who: "Admin, HR", run: (c, p) => org.removeUnit(c, "department", p.id) },
  { method: "POST", path: "/departments/{id}/members", tag: "Organization", summary: "Move people into a department (logged as a transfer)", who: "Admin, HR", body: org.Assign, run: (c, p, _q, b) => org.assignTo(c, "department", p.id, b) },
  { method: "GET", path: "/branches", tag: "Organization", summary: "Branches (offices and sites), with headcount", who: "Anyone", run: (c) => org.listBranches(c) },
  { method: "POST", path: "/branches", tag: "Organization", summary: "Add a branch", who: "Admin, HR", body: org.SaveBranch, created: true, run: (c, _p, _q, b) => org.createBranch(c, b) },
  { method: "PATCH", path: "/branches/{id}", tag: "Organization", summary: "Change a branch", who: "Admin, HR", body: org.SaveBranch.partial(), run: (c, p, _q, b) => org.updateBranch(c, p.id, b) },
  { method: "DELETE", path: "/branches/{id}", tag: "Organization", summary: "Delete an empty branch", who: "Admin, HR", run: (c, p) => org.removeUnit(c, "branch", p.id) },
  { method: "POST", path: "/branches/{id}/members", tag: "Organization", summary: "Move people to a branch", who: "Admin, HR", body: org.Assign, run: (c, p, _q, b) => org.assignTo(c, "branch", p.id, b) },
  { method: "GET", path: "/clients", tag: "Organization", summary: "Client accounts, with headcount; include_archived=true for all", who: "Anyone", run: (c, _p, q) => org.listClients(c, q) },
  { method: "POST", path: "/clients", tag: "Organization", summary: "Add a client account", who: "Admin, HR", body: org.SaveClient, created: true, run: (c, _p, _q, b) => org.createClient(c, b) },
  { method: "PATCH", path: "/clients/{id}", tag: "Organization", summary: "Change or archive a client (archiving takes everyone off it)", who: "Admin, HR", body: org.UpdateClient, run: (c, p, _q, b) => org.updateClient(c, p.id, b) },
  { method: "POST", path: "/clients/{id}/members", tag: "Organization", summary: "Put people on a client account", who: "Admin, HR", body: org.Assign, run: (c, p, _q, b) => org.assignTo(c, "client", p.id, b) },
  { method: "DELETE", path: "/clients/{id}/members", tag: "Organization", summary: "Take people off a client account", who: "Admin, HR", body: org.Assign, run: (c, p, _q, b) => org.unassignClient(c, p.id, b) },
  { method: "GET", path: "/approval-settings", tag: "Requests", summary: "Which roles approve requests, besides each person's direct supervisor", who: "Anyone", run: (c) => req.getApprovalSettings(c) },
  { method: "PATCH", path: "/approval-settings", tag: "Requests", summary: "Turn HR or operations on or off as approvers (admin always approves)", who: "Admin, HR", body: req.ApprovalSettingsBody, run: (c, _p, _q, b) => req.putApprovalSettings(c, b) },
  { method: "GET", path: "/approvers", tag: "Requests", summary: "Who can decide a person's leave, overtime and correction requests", who: "The person, their supervisor, approvers, admin and HR", query: req.ApproversQuery, run: (c, _p, q) => req.getApprovers(c, q) },
  { method: "GET", path: "/schedule", tag: "Schedule", summary: "The schedule: each person's shift, leave and coverage gaps per day (up to 42 days)", who: "Operations, admin, HR: everyone; managers: their team; others: themselves", query: sched.ScheduleQuery, run: (c, _p, q) => sched.getSchedule(c, q) },
  { method: "PUT", path: "/schedule", tag: "Schedule", summary: "Assign shifts or rest days; refused on approved leave, warned on pending leave", who: "Operations, admin, HR", body: sched.PutSchedule, run: (c, _p, _q, b) => sched.putSchedule(c, b) },
  { method: "DELETE", path: "/schedule", tag: "Schedule", summary: "Put days back on each person's default shift", who: "Operations, admin, HR", body: sched.ResetSchedule, run: (c, _p, _q, b) => sched.resetSchedule(c, b) },
  { method: "GET", path: "/schedule/gaps", tag: "Schedule", summary: "Scheduled shifts that approved leave left uncovered", who: "Operations, admin, HR; managers for their team", query: sched.GapsQuery, run: (c, _p, q) => sched.getGaps(c, q) },
  { method: "GET", path: "/schedule/settings", tag: "Schedule", summary: "How far ahead shifts can be scheduled, and the short-notice threshold", who: "Anyone", run: (c) => sched.getSettings(c) },
  { method: "PATCH", path: "/schedule/settings", tag: "Schedule", summary: "Change the scheduling window or short-notice threshold", who: "Operations, admin, HR", body: sched.Settings, run: (c, _p, _q, b) => sched.putSettings(c, b) },
  { method: "GET", path: "/notifications", tag: "Notifications", summary: "Your notifications, newest first", who: "The person", query: sched.ListNotifications, run: (c, _p, q) => sched.listNotifications(c, q) },
  { method: "POST", path: "/notifications/read", tag: "Notifications", summary: "Mark notifications read (all, or the ids given)", who: "The person", body: sched.MarkRead, run: (c, _p, _q, b) => sched.markRead(c, b) },
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
  { method: "GET", path: "/payslips", tag: "Payroll", summary: "Issued payslips, newest first: your own, or anyone's for admin and HR. include_estimate=true adds the open period", who: "Self, admin, HR", query: pay.ListPayslips, run: (c, _p, q) => pay.payslips(c, q) },
  { method: "GET", path: "/payslips/{id}", tag: "Payroll", summary: "One payslip with its day-by-day time (id is period_id:employee_id)", who: "Self, admin, HR", run: (c, p) => pay.payslip(c, p.id) },
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
