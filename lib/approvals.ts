// Who approves leave, overtime and time corrections. One rule for the web app and the API:
// the person's direct supervisor, plus anyone whose role the organization allows to approve.
// Admin can always approve, so a request is never left without an approver. Nobody approves their own.

import type { AppRole, ApprovalSettings, Database, Employee } from "./types";

/** Roles an organization can turn on as approvers. Admin is always one; employees approve only as a supervisor. */
export const OPTIONAL_APPROVER_ROLES = ["hr", "operations"] as const satisfies readonly AppRole[];
export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = { approver_roles: ["hr"] };

export const approverRoles = (db: Database): AppRole[] => ["admin", ...(db.approval_settings ?? DEFAULT_APPROVAL_SETTINGS).approver_roles];

/** The direct supervisor, if they are still active. */
export function supervisorOf(db: Database, employeeId: string): Employee | null {
  const e = db.employees.find((x) => x.id === employeeId);
  const m = e?.manager_id ? db.employees.find((x) => x.id === e.manager_id) : undefined;
  return m && m.status !== "offboarded" && m.id !== employeeId ? m : null;
}

export function canApprove(db: Database, approver: Employee, employeeId: string): boolean {
  if (approver.id === employeeId || approver.status === "offboarded") return false;
  if (approverRoles(db).includes(approver.role)) return true;
  return supervisorOf(db, employeeId)?.id === approver.id;
}

/** Everyone who can decide this person's requests, supervisor first. */
export function approversFor(db: Database, employeeId: string): { supervisor: Employee | null; roles: AppRole[]; people: Employee[] } {
  const supervisor = supervisorOf(db, employeeId);
  const roles = approverRoles(db);
  const people = db.employees.filter((x) => x.status !== "offboarded" && canApprove(db, x, employeeId));
  if (supervisor) people.sort((a, b) => (a.id === supervisor.id ? -1 : b.id === supervisor.id ? 1 : 0));
  return { supervisor, roles, people };
}

const ROLE_PLURAL: Record<AppRole, string> = { admin: "admin", hr: "HR", operations: "operations", employee: "employees" };

/** "your supervisor, Ana Reyes, or HR and admin" style text for the person filing. */
export function approverText(db: Database, employeeId: string, name: (e: Employee) => string): string {
  const { supervisor, roles } = approversFor(db, employeeId);
  const r = roles.filter((x) => x !== "admin").map((x) => ROLE_PLURAL[x]);
  const list = [...r, "admin"];
  const roleText = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return supervisor ? `your supervisor, ${name(supervisor)}, or ${roleText}` : roleText;
}
