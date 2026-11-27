"use client";

// In-memory data layer for the prototype. Every read and write goes through this module,
// so moving to Supabase means re-implementing these functions with supabase-js queries
// (and React Query / server actions) without touching the views.

import { useSyncExternalStore } from "react";
import type { Database, Employee, OnboardingCase, OnboardingTask } from "./types";
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
