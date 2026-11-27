// The /api/v1 request pipeline: authenticate, route, validate, run, and shape every response the same way.

import { randomUUID } from "node:crypto";
import { authenticate } from "./auth";
import { ApiError } from "./errors";
import { match } from "./routes";
import { openApiSpec } from "./openapi";

const json = (status: number, body: unknown, requestId: string, extra: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId, "cache-control": "no-store", ...extra },
  });

const errorBody = (e: ApiError) => ({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });

export async function handle(req: Request, now: () => string = () => new Date().toISOString()): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/v1/, "") || "/";
  try {
    if (req.method === "GET" && path === "/openapi.json") return json(200, openApiSpec(url.origin), requestId);
    const m = match(req.method, path);
    if (!m) throw new ApiError("not_found", `No route for ${req.method} ${path}.`);
    if ("allowed" in m) return json(405, { error: { code: "method_not_allowed", message: `Use ${m.allowed.join(" or ")}.` } }, requestId, { allow: m.allowed.join(", ") });

    const at = now();
    const auth = await authenticate(req.headers.get("authorization"), at);
    const ctx = { ...auth, now: at, requestId };

    let body: unknown = undefined;
    if (req.method !== "GET") {
      const text = await req.text();
      if (text) {
        if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new ApiError("validation_failed", "Send JSON with Content-Type: application/json.");
        try { body = JSON.parse(text); } catch { throw new ApiError("validation_failed", "The body isn't valid JSON."); }
      }
    }

    // Idempotent retries: same key and caller, same answer, work done once.
    const idemKey = req.method === "POST" ? req.headers.get("idempotency-key") : null;
    const who = auth.principal.kind === "key" ? `key:${auth.principal.key.id}` : `user:${auth.principal.employee.id}`;
    const scope = `${who}:${req.method}:${path}`;
    if (idemKey) {
      const hit = await auth.repo.getIdempotent(scope, idemKey);
      if (hit) return json(hit.status, hit.body, requestId, { "idempotent-replayed": "true" });
    }

    const query = Object.fromEntries(url.searchParams);
    const result = await m.route.run(ctx, m.params, query, body);
    const status = m.route.created ? 201 : 200;
    if (idemKey) await auth.repo.putIdempotent(scope, idemKey, { status, body: result, created_at: at });
    return json(status, result, requestId);
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, errorBody(e), requestId);
    console.error(`[api] ${requestId}`, e);
    return json(500, errorBody(new ApiError("internal", "Something went wrong on our side. Quote the request ID to support.")), requestId);
  }
}
