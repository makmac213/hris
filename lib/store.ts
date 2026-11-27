"use client";

// In-memory data layer for the prototype. Every read and write goes through this module,
// so moving to Supabase means re-implementing these functions with supabase-js queries
// (and React Query / server actions) without touching the views.

import { useSyncExternalStore } from "react";
import type { Client, Department, Location, ScheduleSettings, LeaveAdjustment, LeaveRequest, LeaveType, SeparationReason, AppRole, Compensation, CorrectionKind, CorrectionRequest, Database, Employee, EmployeePayrollSettings, OnboardingCase, OnboardingTask, OvertimeRequest, PayItem, PayItemType, PayrollSettings, ShiftCode, TimeRecord } from "./types";
import { type AssignmentInput, assignmentId, checkAssignments, leaveNotifications, lockReason, scheduleFor, toAssignments, workDateFor as workDateForDb } from "./schedule";
import { buildOnboardingTasks, ORG_ID, seed, TEMPLATE_ID, TODAY } from "./mock-data";
import { probationEndFor } from "./employment";

let db: Database = seed;
const listeners = new Set<() => void>();

function commit(next: Database) {
  db = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDb(): Database {
  return useSyncExternalStore(subscribe, () => db, () => seed);
}

export const today = () => TODAY;

// ---- Session (who is signed in) ---------------------------------------------
// The prototype lets you switch between an admin and an employee to see both sides.

let currentUserId = "e04";
const sessionListeners = new Set<() => void>();
export function setCurrentUser(id: string) {
  currentUserId = id;
  sessionListeners.forEach((l) => l());
}
/** Admin, HR and operations schedule shifts for anyone. */
export const canSchedule = (e: Pick<Employee, "role">) => e.role === "admin" || e.role === "hr" || e.role === "operations";

export function useCurrentUser(): { employee: Employee; role: AppRole; canManage: boolean; canSchedule: boolean } {
  const id = useSyncExternalStore(
    (l) => { sessionListeners.add(l); return () => sessionListeners.delete(l); },
    () => currentUserId,
    () => "e04",
  );
  const d = useDb();
  const employee = d.employees.find((e) => e.id === id)!;
  return { employee, role: employee.role, canManage: employee.role === "admin" || employee.role === "hr", canSchedule: canSchedule(employee) };
}

export const PROTOTYPE_USERS = [
  { id: "e04", label: "Marisol Dela Cruz", sub: "Admin" },
  { id: "e10", label: "Leah Santos", sub: "HR" },
  { id: "e40", label: "Jerome Tolentino", sub: "Operations" },
  { id: "e41", label: "Angelica Santiago", sub: "Team lead" },
  { id: "e06", label: "Priya Raman", sub: "Manager" },
  { id: "e16", label: "Miguel Ramos", sub: "Employee" },
  { id: "e25", label: "Paolo Mendoza", sub: "Employee, half-day" },
];

// ---- Queries -------------------------------------------------------------

export function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

export function directReports(d: Database, managerId: string): Employee[] {
  return d.employees.filter((e) => e.manager_id === managerId && e.status !== "offboarded");
}

export function reportingChain(d: Database, id: string): Employee[] {
  const byId = indexById(d.employees);
  const chain: Employee[] = [];
  let cur = byId.get(id);
  while (cur?.manager_id && chain.length < 20) {
    cur = byId.get(cur.manager_id);
    if (cur) chain.unshift(cur);
  }
  return chain;
}

export interface CaseSummary {
  kase: OnboardingCase;
  employee: Employee;
  tasks: OnboardingTask[];
  done: number;
  overdue: number;
  next: OnboardingTask | undefined;
}

export function caseSummary(d: Database, kase: OnboardingCase): CaseSummary | null {
  const employee = d.employees.find((e) => e.id === kase.employee_id);
  if (!employee) return null;
  const tasks = d.onboarding_tasks.filter((t) => t.case_id === kase.id).sort((a, b) => a.position - b.position);
  const open = tasks.filter((t) => !t.completed_at);
  return {
    kase,
    employee,
    tasks,
    done: tasks.length - open.length,
    overdue: open.filter((t) => t.due_date < TODAY).length,
    next: open[0],
  };
}

// ---- Mutations -----------------------------------------------------------

export interface NewEmployeeInput {
  first_name: string;
  last_name: string;
  work_email: string;
  job_title: string;
  department_id: string;
  location_id: string;
  manager_id: string | null;
  start_date: string;
  employment_type: Employee["employment_type"];
  client_id?: string | null;
}

/** New hires in a Philippine office start on probation. Standards must be given in writing on day one (Art. 296). */
function phTermsForNewHire(locationId: string, start: string): Pick<Employee, "employment_status_ph" | "probation_end_date" | "standards_given_on" | "contract_end_date" | "regularized_on" | "birth_date" | "separation_reason" | "separation_notice_date"> {
  const ph = !!db.locations.find((l) => l.id === locationId)?.ph_region;
  return {
    employment_status_ph: ph ? "probationary" : null, probation_end_date: ph ? probationEndFor(start) : null, standards_given_on: null,
    contract_end_date: null, regularized_on: null, birth_date: null, separation_reason: null, separation_notice_date: null,
  };
}

export function createEmployee(input: NewEmployeeInput): Employee {
  const n = db.employees.length + 1;
  const id = `e${String(n).padStart(2, "0")}x${Date.now().toString(36)}`;
  const employee: Employee = {
    ...input,
    client_id: input.client_id ?? null,
    id,
    organization_id: ORG_ID,
    employee_number: `HLD-${String(n).padStart(4, "0")}`,
    preferred_name: null,
    pronouns: null,
    phone: null,
    status: input.start_date > TODAY ? "onboarding" : "active",
    end_date: null,
    avatar_url: null,
    role: "employee",
    shift_code_id: db.shift_codes.find((s) => s.is_default)?.id ?? null,
    ...phTermsForNewHire(input.location_id, input.start_date),
  };
  const kase: OnboardingCase = {
    id: `ob-${id}`, employee_id: id, template_id: TEMPLATE_ID, buddy_id: null, status: "in_progress", created_at: TODAY,
  };
  commit({
    ...db,
    employees: [...db.employees, employee],
    employment_events: [
      ...db.employment_events,
      { id: `ev-${id}-hire`, employee_id: id, effective_date: input.start_date, kind: "hired", job_title: input.job_title, department_id: input.department_id, note: null },
    ],
    onboarding_cases: [...db.onboarding_cases, kase],
    onboarding_tasks: [...db.onboarding_tasks, ...buildOnboardingTasks(kase.id, input.start_date, null)],
  });
  return employee;
}

export function updateEmployee(id: string, patch: Partial<Employee>) {
  commit({ ...db, employees: db.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
}

export function setTaskDone(taskId: string, done: boolean) {
  commit({
    ...db,
    onboarding_tasks: db.onboarding_tasks.map((t) =>
      t.id === taskId ? { ...t, completed_at: done ? `${TODAY}T09:00:00Z` : null } : t),
  });
}

// Assigning a buddy also ticks the matching checklist task, so the two never disagree.
export function setBuddy(caseId: string, buddyId: string | null) {
  commit({
    ...db,
    onboarding_cases: db.onboarding_cases.map((c) => (c.id === caseId ? { ...c, buddy_id: buddyId } : c)),
    onboarding_tasks: db.onboarding_tasks.map((t) =>
      t.case_id === caseId && t.title === "Choose an onboarding buddy"
        ? { ...t, completed_at: buddyId ? (t.completed_at ?? `${TODAY}T09:00:00Z`) : null }
        : t),
  });
}

// ---- Timekeeping -----------------------------------------------------------

export type NewShiftCode = Omit<ShiftCode, "id" | "organization_id" | "is_default" | "archived_at">;

export function addShiftCodes(rows: NewShiftCode[]): ShiftCode[] {
  const created = rows.map((r) => ({
    ...r,
    id: `sc-${r.code.toLowerCase()}-${Date.now().toString(36)}`,
    organization_id: ORG_ID,
    is_default: false,
    archived_at: null,
  }));
  commit({ ...db, shift_codes: [...db.shift_codes, ...created] });
  return created;
}

export function setDefaultShift(id: string) {
  commit({ ...db, shift_codes: db.shift_codes.map((s) => ({ ...s, is_default: s.id === id })) });
}

/** Archives a code. People keep it until they're reassigned, so existing time records still make sense. */
export function archiveShiftCode(id: string, archived: boolean) {
  commit({
    ...db,
    shift_codes: db.shift_codes.map((s) => (s.id === id ? { ...s, archived_at: archived ? new Date().toISOString() : null, is_default: archived ? false : s.is_default } : s)),
  });
}

export function assignShift(employeeIds: string[], shiftId: string | null) {
  const ids = new Set(employeeIds);
  commit({ ...db, employees: db.employees.map((e) => (ids.has(e.id) ? { ...e, shift_code_id: shiftId } : e)) });
}

export interface TimeCapture {
  employeeId: string;
  kind: TimeRecord["kind"];
  photo: string; // data URL in the prototype; a Storage key in production
  latitude: number;
  longitude: number;
  accuracy_m: number;
  device: string;
}

/**
 * In production this is a server action: the server stamps recorded_at, uploads the photo to the private
 * time-photos bucket and rejects the insert if any of photo, latitude/longitude or accuracy is missing.
 */
export function recordTime(c: TimeCapture): TimeRecord {
  if (!c.photo || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) {
    throw new Error("A photo and a location are both required.");
  }
  const emp = db.employees.find((e) => e.id === c.employeeId)!;
  const nowIso = new Date().toISOString();
  const rec: TimeRecord = {
    id: `tr-${c.employeeId}-${Date.now().toString(36)}`,
    organization_id: ORG_ID,
    employee_id: c.employeeId,
    shift_code_id: scheduleFor(db, emp, workDateForDb(db, emp, nowIso)).assignment?.shift_code_id ?? emp.shift_code_id,
    kind: c.kind,
    recorded_at: nowIso,
    work_date: workDateFor(emp, nowIso),
    source: "device",
    correction_request_id: null,
    photo_path: c.photo,
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy_m: c.accuracy_m,
    device: c.device,
  };
  commit({ ...db, time_records: [...db.time_records, rec] });
  return rec;
}

/** Overnight shifts belong to the day they started (see lib/schedule.ts). */
export const workDateFor = (emp: Employee, iso: string) => workDateForDb(db, emp, iso);

// ---- Requests: overtime and time corrections -------------------------------------

/** Managers approve their own direct reports; admin and HR approve anyone. Nobody approves their own request. */
export function canApprove(d: Database, approver: Employee, employeeId: string): boolean {
  if (approver.id === employeeId) return false;
  if (approver.role === "admin" || approver.role === "hr") return true;
  return d.employees.find((e) => e.id === employeeId)?.manager_id === approver.id;
}

export function isPeriodLocked(d: Database, date: string): boolean {
  return d.payroll_periods.some((p) => p.status !== "open" && date >= p.start_date && date <= p.end_date);
}

export function fileOvertime(input: Pick<OvertimeRequest, "employee_id" | "work_date" | "start_at" | "end_at" | "reason">): OvertimeRequest {
  const req: OvertimeRequest = {
    ...input, id: `ot-${Date.now().toString(36)}`, status: "pending", filed_at: new Date().toISOString(),
    decided_by: null, decided_at: null, decision_note: null,
  };
  commit({ ...db, overtime_requests: [...db.overtime_requests, req] });
  return req;
}

export function fileCorrection(input: { employee_id: string; work_date: string; kind: CorrectionKind; proposed_at: string; reason: string }): CorrectionRequest {
  const k = input.kind.endsWith("_in") ? "clock_in" : "clock_out";
  const original = db.time_records.find((r) => r.employee_id === input.employee_id && r.work_date === input.work_date && r.kind === k && r.source === "device");
  const req: CorrectionRequest = {
    ...input, id: `cr-${Date.now().toString(36)}`, original_record_id: original?.id ?? null, status: "pending",
    filed_at: new Date().toISOString(), decided_by: null, decided_at: null, decision_note: null,
  };
  commit({ ...db, correction_requests: [...db.correction_requests, req] });
  return req;
}

export function cancelRequest(type: "overtime" | "correction", id: string) {
  if (type === "overtime") commit({ ...db, overtime_requests: db.overtime_requests.map((r) => (r.id === id && r.status === "pending" ? { ...r, status: "cancelled" } : r)) });
  else commit({ ...db, correction_requests: db.correction_requests.map((r) => (r.id === id && r.status === "pending" ? { ...r, status: "cancelled" } : r)) });
}

export function decideRequest(type: "overtime" | "correction", id: string, approverId: string, approve: boolean, note: string | null) {
  const decided = { status: approve ? ("approved" as const) : ("rejected" as const), decided_by: approverId, decided_at: new Date().toISOString(), decision_note: note };
  if (type === "overtime") {
    commit({ ...db, overtime_requests: db.overtime_requests.map((r) => (r.id === id ? { ...r, ...decided } : r)) });
    return;
  }
  const req = db.correction_requests.find((r) => r.id === id)!;
  const emp = db.employees.find((e) => e.id === req.employee_id)!;
  // Approval appends a correction record. The original device record stays untouched for the audit trail.
  const rec: TimeRecord | null = approve ? {
    id: `tr-corr-${id}`, organization_id: ORG_ID, employee_id: req.employee_id, shift_code_id: emp.shift_code_id,
    kind: req.kind.endsWith("_in") ? "clock_in" : "clock_out", recorded_at: req.proposed_at, work_date: req.work_date,
    source: "correction", correction_request_id: id, photo_path: null, latitude: null, longitude: null, accuracy_m: null, device: null,
  } : null;
  commit({
    ...db,
    correction_requests: db.correction_requests.map((r) => (r.id === id ? { ...r, ...decided } : r)),
    time_records: rec ? [...db.time_records, rec] : db.time_records,
  });
}

export function finalizePayroll(periodId: string, byId: string) {
  commit({ ...db, payroll_periods: db.payroll_periods.map((p) => (p.id === periodId ? { ...p, status: "finalized", finalized_at: new Date().toISOString(), finalized_by: byId } : p)) });
}

// ---- Payroll settings and pay items ------------------------------------------------

export function updatePayrollSettings(patch: Partial<PayrollSettings>) {
  commit({ ...db, payroll_settings: { ...db.payroll_settings, ...patch } });
}

export function setEmployeePayrollSettings(employeeId: string, patch: Partial<Omit<EmployeePayrollSettings, "employee_id">>) {
  const existing = db.employee_payroll_settings.find((s) => s.employee_id === employeeId) ?? {
    employee_id: employeeId, employer_pays_sss: null, employer_pays_philhealth: null, employer_pays_pagibig: null, pagibig_voluntary: 0,
  };
  const next = { ...existing, ...patch };
  commit({ ...db, employee_payroll_settings: [...db.employee_payroll_settings.filter((s) => s.employee_id !== employeeId), next] });
}

export function updateCompensation(employeeId: string, patch: Partial<Pick<Compensation, "pay_basis" | "rate" | "is_managerial">>) {
  commit({ ...db, compensation: db.compensation.map((c) => (c.employee_id === employeeId ? { ...c, ...patch } : c)) });
}

export function addPayItem(input: Omit<PayItem, "id" | "created_at">): PayItem {
  const row: PayItem = { ...input, id: `pi-${Date.now().toString(36)}`, created_at: new Date().toISOString() };
  commit({ ...db, pay_items: [...db.pay_items, row] });
  return row;
}

/** Stop a recurring item from the given date. Items are never deleted, so past payslips stay explainable. */
export function endPayItem(id: string, endDate: string) {
  commit({ ...db, pay_items: db.pay_items.map((p) => (p.id === id ? { ...p, end_date: endDate } : p)) });
}

export function savePayItemType(row: Omit<PayItemType, "id"> & { id?: string }): PayItemType {
  const saved: PayItemType = { ...row, id: row.id ?? `pt-${Date.now().toString(36)}` };
  const exists = db.pay_item_types.some((t) => t.id === saved.id);
  commit({ ...db, pay_item_types: exists ? db.pay_item_types.map((t) => (t.id === saved.id ? saved : t)) : [...db.pay_item_types, saved] });
  return saved;
}

// ---- Leave -----------------------------------------------------------------------

export function fileLeave(input: Pick<LeaveRequest, "employee_id" | "leave_type_id" | "start_date" | "end_date" | "half_day" | "reason">): LeaveRequest {
  const row: LeaveRequest = { ...input, id: `lv-${Date.now().toString(36)}`, status: "pending", filed_at: new Date().toISOString(), decided_by: null, decided_at: null, decision_note: null };
  const next = { ...db, leave_requests: [...db.leave_requests, row] };
  // Short-notice leave on a scheduled shift: operations hears about it now, not at approval.
  commit({ ...next, notifications: [...next.notifications, ...leaveNotifications(next, row, "filed", TODAY, row.filed_at, uid, null)] });
  return row;
}

export function cancelLeave(id: string) {
  commit({ ...db, leave_requests: db.leave_requests.map((r) => (r.id === id && r.status === "pending" ? { ...r, status: "cancelled" as const } : r)) });
}

export function decideLeave(id: string, approverId: string, approve: boolean, note: string | null) {
  const decided = { status: approve ? ("approved" as const) : ("rejected" as const), decided_by: approverId, decided_at: new Date().toISOString(), decision_note: note };
  const next = { ...db, leave_requests: db.leave_requests.map((r) => (r.id === id ? { ...r, ...decided } : r)) };
  const row = next.leave_requests.find((r) => r.id === id)!;
  // Approved leave on scheduled shifts: tell operations, the manager and whoever scheduled them.
  const sent = approve ? leaveNotifications(next, row, "approved", TODAY, decided.decided_at, uid, approverId) : [];
  commit({ ...next, notifications: [...next.notifications, ...sent] });
}

/** Saves a leave policy. Statutory types can be made more generous, never less (enforced in the form and here). */
export function saveLeaveType(row: Omit<LeaveType, "id"> & { id?: string }): LeaveType {
  const id = row.id ?? `lt-${Date.now().toString(36)}`;
  const safe: LeaveType = { ...row, id, days: Math.max(row.days, row.legal_min_days) };
  commit({ ...db, leave_types: db.leave_types.some((t) => t.id === id) ? db.leave_types.map((t) => (t.id === id ? safe : t)) : [...db.leave_types, safe] });
  return safe;
}

export function adjustLeave(input: Omit<LeaveAdjustment, "id">) {
  commit({ ...db, leave_adjustments: [...db.leave_adjustments, { ...input, id: `la-${Date.now().toString(36)}` }] });
}

// ---- Employment terms and separation ----------------------------------------------

export function regularize(id: string, on: string) {
  const e = db.employees.find((x) => x.id === id)!;
  commit({
    ...db,
    employees: db.employees.map((x) => (x.id === id ? { ...x, employment_status_ph: "regular" as const, regularized_on: on, contract_end_date: null } : x)),
    employment_events: [...db.employment_events, { id: `ev-${id}-reg-${on}`, employee_id: id, effective_date: on, kind: "regularized", job_title: e.job_title, department_id: e.department_id, note: "Regularized" }],
  });
}

export function separateEmployee(id: string, lastDay: string, reason: SeparationReason, noticeDate: string | null) {
  const e = db.employees.find((x) => x.id === id)!;
  commit({
    ...db,
    employees: db.employees.map((x) => (x.id === id ? { ...x, end_date: lastDay, separation_reason: reason, separation_notice_date: noticeDate, status: lastDay < TODAY ? "offboarded" as const : x.status } : x)),
    employment_events: [...db.employment_events, { id: `ev-${id}-sep-${lastDay}`, employee_id: id, effective_date: lastDay, kind: "separated", job_title: e.job_title, department_id: e.department_id, note: null }],
  });
}

// ---- Organization: departments, branches, clients ----------------------------------

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}${(++seq).toString(36)}`;

type OrgField = "department_id" | "location_id" | "client_id";
const peopleIn = (field: OrgField, id: string) => db.employees.filter((e) => e[field] === id && e.status !== "offboarded");

export function saveDepartment(row: Pick<Department, "name" | "head_id"> & { id?: string }): Department {
  const saved: Department = { id: row.id ?? uid("dep"), organization_id: ORG_ID, name: row.name.trim(), head_id: row.head_id };
  commit({ ...db, departments: db.departments.some((d) => d.id === saved.id) ? db.departments.map((d) => (d.id === saved.id ? saved : d)) : [...db.departments, saved] });
  return saved;
}

export function saveBranch(row: Omit<Location, "id" | "organization_id"> & { id?: string }): Location {
  const saved: Location = { ...row, id: row.id ?? uid("loc"), organization_id: ORG_ID, name: row.name.trim() };
  commit({ ...db, locations: db.locations.some((l) => l.id === saved.id) ? db.locations.map((l) => (l.id === saved.id ? saved : l)) : [...db.locations, saved] });
  return saved;
}

export function saveClient(row: Pick<Client, "name" | "code" | "industry"> & { id?: string }): Client {
  const existing = db.clients.find((c) => c.id === row.id);
  const saved: Client = { id: row.id ?? uid("cl"), organization_id: ORG_ID, name: row.name.trim(), code: row.code.trim().toUpperCase(), industry: row.industry, archived_at: existing?.archived_at ?? null };
  commit({ ...db, clients: existing ? db.clients.map((c) => (c.id === saved.id ? saved : c)) : [...db.clients, saved] });
  return saved;
}

/** Archiving a client takes everyone off it; past records keep the name. */
export function archiveClient(id: string, archived: boolean) {
  commit({
    ...db,
    clients: db.clients.map((c) => (c.id === id ? { ...c, archived_at: archived ? new Date().toISOString() : null } : c)),
    employees: archived ? db.employees.map((e) => (e.client_id === id ? { ...e, client_id: null } : e)) : db.employees,
  });
}

/** Deletes a department or branch nobody is in. Returns why it can't, or null. */
export function deleteOrgUnit(kind: "department" | "branch", id: string): string | null {
  const field: OrgField = kind === "department" ? "department_id" : "location_id";
  const n = db.employees.filter((e) => e[field] === id).length;
  if (n) return `${n} ${n === 1 ? "person is" : "people are"} still assigned here, including former staff. Move them first.`;
  if (kind === "department") commit({ ...db, departments: db.departments.filter((d) => d.id !== id) });
  else commit({ ...db, locations: db.locations.filter((l) => l.id !== id) });
  return null;
}

/** Moves people into a department, branch or client (null takes them off a client). Department moves are logged as transfers. */
export function assignPeople(field: OrgField, value: string | null, employeeIds: string[]) {
  const ids = new Set(employeeIds);
  const moved = db.employees.filter((e) => ids.has(e.id) && e[field] !== value);
  const dept = field === "department_id" ? db.departments.find((d) => d.id === value) : undefined;
  commit({
    ...db,
    employees: db.employees.map((e) => (ids.has(e.id) ? { ...e, [field]: value } : e)),
    employment_events: dept
      ? [...db.employment_events, ...moved.map((e) => ({ id: uid("ev"), employee_id: e.id, effective_date: TODAY, kind: "transfer" as const, job_title: e.job_title, department_id: dept.id, note: `Moved to ${dept.name}` }))]
      : db.employment_events,
  });
}

export { peopleIn };

// ---- Schedule ------------------------------------------------------------------------

/** Assigns shifts (or rest days). All or nothing: any error and nothing is saved. Pending leave comes back as warnings. */
export function assignSchedule(entries: AssignmentInput[], byId: string) {
  const { errors, warnings } = checkAssignments(db, entries, TODAY);
  if (Object.keys(errors).length) return { errors, warnings, saved: 0 };
  const rows = toAssignments(ORG_ID, entries, byId, new Date().toISOString());
  const keys = new Set(rows.map((r) => r.id));
  commit({ ...db, shift_assignments: [...db.shift_assignments.filter((a) => !keys.has(a.id)), ...rows] });
  return { errors, warnings, saved: rows.length };
}

/** Puts days back on the person's default shift. Locked days are skipped. */
export function resetSchedule(cells: { employee_id: string; work_date: string }[]) {
  const ok = new Set(cells.filter((c) => {
    const e = db.employees.find((x) => x.id === c.employee_id);
    return e && !lockReason(db, e, c.work_date, TODAY);
  }).map((c) => assignmentId(c.employee_id, c.work_date)));
  commit({ ...db, shift_assignments: db.shift_assignments.filter((a) => !ok.has(a.id)) });
  return ok.size;
}

export function updateScheduleSettings(patch: Partial<ScheduleSettings>) {
  commit({ ...db, schedule_settings: { ...db.schedule_settings, ...patch } });
}

// ---- Notifications -------------------------------------------------------------------

export function markNotificationsRead(recipientId: string, ids?: string[]) {
  const at = new Date().toISOString();
  commit({ ...db, notifications: db.notifications.map((n) => (n.recipient_id === recipientId && !n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: at } : n)) });
}
