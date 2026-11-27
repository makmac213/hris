// Who is calling, and what they may do. Same rules as the web app (lib/approvals.ts).

import type { AppRole, Database, Employee } from "@/lib/types";
import { canApprove } from "@/lib/approvals";
import { forbidden } from "./errors";
import type { ApiKey, ApiScope, Repository } from "./repo/types";

export type Principal =
  | { kind: "user"; employee: Employee; role: AppRole }
  | { kind: "key"; key: ApiKey };

export interface Ctx {
  repo: Repository;
  orgId: string;
  principal: Principal;
  now: string; // ISO instant, fixed for the whole request
  requestId: string;
}

/** Admin and HR, and API keys (limited by scope instead). */
export const isPrivileged = (ctx: Ctx) => ctx.principal.kind === "key" || ctx.principal.role === "admin" || ctx.principal.role === "hr";

export const selfId = (ctx: Ctx) => (ctx.principal.kind === "user" ? ctx.principal.employee.id : null);

export function requireScope(ctx: Ctx, scope: ApiScope) {
  if (ctx.principal.kind === "key" && !ctx.principal.key.scopes.includes(scope)) throw forbidden(`This API key needs the ${scope} scope.`);
}

export function requirePrivileged(ctx: Ctx, scope: ApiScope) {
  requireScope(ctx, scope);
  if (!isPrivileged(ctx)) throw forbidden("Only admin and HR can do this.");
}

/** Self, admin/HR, or (when allowed) the person's direct manager. */
export function canSee(ctx: Ctx, db: Database, employeeId: string, opts: { manager: boolean }) {
  if (isPrivileged(ctx)) return true;
  const me = selfId(ctx);
  if (me === employeeId) return true;
  return opts.manager && db.employees.find((e) => e.id === employeeId)?.manager_id === me;
}

/** The direct supervisor, or anyone whose role the organization allows to approve (lib/approvals.ts). Nobody decides their own. */
export function canDecide(ctx: Ctx, db: Database, employeeId: string) {
  if (ctx.principal.kind === "key") return false; // a decision needs a person
  return canApprove(db, ctx.principal.employee, employeeId);
}

export function deciderId(ctx: Ctx): string {
  if (ctx.principal.kind !== "user") throw forbidden("Decisions are made by a person, not an API key.");
  return ctx.principal.employee.id;
}

/** Admin, HR and operations schedule shifts; API keys with schedule:write too. */
export function requireScheduler(ctx: Ctx) {
  requireScope(ctx, "schedule:write");
  if (ctx.principal.kind === "key") return;
  if (!["admin", "hr", "operations"].includes(ctx.principal.role)) throw forbidden("Only operations, admin and HR can change the schedule.");
}

/** Who the caller can see on the schedule: everyone for schedulers and keys, their direct reports for managers, themselves. */
export function scheduleScope(ctx: Ctx, db: Database): (employeeId: string) => boolean {
  if (ctx.principal.kind === "key" || ["admin", "hr", "operations"].includes(ctx.principal.role)) return () => true;
  const me = ctx.principal.employee.id;
  const reports = new Set(db.employees.filter((e) => e.manager_id === me).map((e) => e.id));
  return (id) => id === me || reports.has(id);
}
