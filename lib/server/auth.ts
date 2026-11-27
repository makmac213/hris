// Bearer tokens: an API key (hk_live_…), a Supabase session JWT, or, in memory mode outside production,
// a development token "dev:<employee_id>".

import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "./errors";
import type { Principal } from "./context";
import { dataMode, repoFor, systemRepo } from "./repo";
import type { ApiKey, ApiScope, Repository } from "./repo/types";
import { serviceClient } from "./repo/supabase";

export const KEY_PREFIX = "hk_live_";
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Creates a new API key. The full key is returned once; only its hash is stored. */
export function generateApiKey(orgId: string, name: string, scopes: ApiScope[], now: string): { key: string; row: ApiKey } {
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  return {
    key,
    row: { id: `key-${randomBytes(6).toString("hex")}`, organization_id: orgId, name, prefix: key.slice(0, 12), hash: hashKey(key), scopes, created_at: now, expires_at: null, revoked_at: null, last_used_at: null },
  };
}

export const devTokensAllowed = () => dataMode() === "memory" && process.env.NODE_ENV !== "production" && process.env.HALDEN_DEV_TOKENS !== "0";

export interface Authenticated { principal: Principal; orgId: string; repo: Repository }

export async function authenticate(header: string | null, now: string): Promise<Authenticated> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new ApiError("unauthenticated", "Send an Authorization: Bearer token.");
  const sys = systemRepo();

  if (token.startsWith(KEY_PREFIX)) {
    const key = await sys.findApiKey(hashKey(token));
    if (!key || key.revoked_at || (key.expires_at && key.expires_at < now)) throw new ApiError("unauthenticated", "This API key isn't valid.");
    await sys.touchApiKey(key.id, now);
    return { principal: { kind: "key", key }, orgId: key.organization_id, repo: repoFor({ kind: "key" }) };
  }

  let userId: string | null = null;
  let accessToken: string | null = null;
  if (token.startsWith("dev:")) {
    if (!devTokensAllowed()) throw new ApiError("unauthenticated", "Development tokens are turned off here.");
    userId = token.slice(4);
  } else if (dataMode() === "supabase") {
    const { data, error } = await serviceClient().auth.getUser(token);
    if (error || !data.user) throw new ApiError("unauthenticated", "Your session has expired. Sign in again.");
    userId = data.user.id;
    accessToken = token;
  } else {
    throw new ApiError("unauthenticated", "Unknown token.");
  }

  const link = await sys.findEmployeeByUser(userId);
  if (!link) throw new ApiError("forbidden", "This account isn't linked to an employee.");
  const repo = repoFor({ kind: "user", accessToken });
  const db = await repo.snapshot(link.orgId);
  const employee = db.employees.find((e) => e.id === link.employeeId);
  if (!employee || employee.status === "offboarded") throw new ApiError("forbidden", "This employee no longer has access.");
  return { principal: { kind: "user", employee, role: employee.role }, orgId: link.orgId, repo };
}
