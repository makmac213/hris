// Who is calling, and what they may do. Same rules as the web app (lib/store.ts canApprove).

import type { AppRole, Database, Employee } from "@/lib/types";
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

/** Managers decide their direct reports' requests; admin and HR decide anyone's. Nobody decides their own. */
export function canDecide(ctx: Ctx, db: Database, employeeId: string) {
  if (ctx.principal.kind === "key") return false; // a decision needs a person
  const me = ctx.principal.employee;
  if (me.id === employeeId) return false;
  if (me.role === "admin" || me.role === "hr") return true;
  return db.employees.find((e) => e.id === employeeId)?.manager_id === me.id;
}

export function deciderId(ctx: Ctx): string {
  if (ctx.principal.kind !== "user") throw forbidden("Decisions are made by a person, not an API key.");
  return ctx.principal.employee.id;
}
