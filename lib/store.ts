"use client";

// In-memory data layer for the prototype. Every read and write goes through this module,
// so moving to Supabase means re-implementing these functions with supabase-js queries
// (and React Query / server actions) without touching the views.

import { useSyncExternalStore } from "react";
import type { AppRole, Database, Employee, OnboardingCase, OnboardingTask, ShiftCode, TimeRecord } from "./types";
import { zoned } from "./time";
import { buildOnboardingTasks, ORG_ID, seed, TEMPLATE_ID, TODAY } from "./mock-data";

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
export function useCurrentUser(): { employee: Employee; role: AppRole; canManage: boolean } {
  const id = useSyncExternalStore(
    (l) => { sessionListeners.add(l); return () => sessionListeners.delete(l); },
    () => currentUserId,
    () => "e04",
  );
  const d = useDb();
  const employee = d.employees.find((e) => e.id === id)!;
  return { employee, role: employee.role, canManage: employee.role === "admin" || employee.role === "hr" };
}

export const PROTOTYPE_USERS = [
  { id: "e04", label: "Marisol Dela Cruz", sub: "Admin" },
  { id: "e10", label: "Leah Santos", sub: "HR" },
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
}

export function createEmployee(input: NewEmployeeInput): Employee {
  const n = db.employees.length + 1;
  const id = `e${String(n).padStart(2, "0")}x${Date.now().toString(36)}`;
  const employee: Employee = {
    ...input,
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
    shift_code_id: emp.shift_code_id,
    kind: c.kind,
    recorded_at: nowIso,
    work_date: workDateFor(emp, nowIso),
    photo_path: c.photo,
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy_m: c.accuracy_m,
    device: c.device,
  };
  commit({ ...db, time_records: [...db.time_records, rec] });
  return rec;
}

/** Overnight shifts belong to the day they started: a 2 AM clock-out on a 10 PM shift counts for the day before. */
export function workDateFor(emp: Employee, iso: string): string {
  const shift = db.shift_codes.find((s) => s.id === emp.shift_code_id);
  const z = zoned(iso, shift?.timezone);
  if (shift && shift.end_time <= shift.start_time) {
    const [eh, em] = shift.end_time.split(":").map(Number);
    if (z.minutes < eh * 60 + em + 4 * 60) {
      const d = new Date(`${z.date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      const open = db.time_records.some((r) => r.employee_id === emp.id && r.work_date === d.toISOString().slice(0, 10));
      if (open) return d.toISOString().slice(0, 10);
    }
  }
  return z.date;
}
