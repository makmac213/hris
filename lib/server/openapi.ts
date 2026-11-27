// OpenAPI 3.1 spec built from the route table, so it can't drift from the code.

import { z, type ZodTypeAny } from "zod";
import { ROUTES } from "./routes";

/** Enough of Zod → JSON Schema for the shapes this API uses. */
export function jsonSchema(s: ZodTypeAny): Record<string, unknown> {
  const def = s._def;
  if (s instanceof z.ZodOptional) return jsonSchema(s.unwrap());
  if (s instanceof z.ZodDefault) return { ...jsonSchema(def.innerType), default: def.defaultValue() };
  if (s instanceof z.ZodNullable) { const inner = jsonSchema(s.unwrap()); return { ...inner, type: [inner.type, "null"].flat() }; }
  if (s instanceof z.ZodEffects) return jsonSchema(def.schema);
  if (s instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    for (const c of def.checks) { if (c.kind === "email") out.format = "email"; if (c.kind === "regex") out.pattern = c.regex.source; if (c.kind === "min") out.minLength = c.value; }
    return out;
  }
  if (s instanceof z.ZodNumber) return { type: def.checks.some((c: { kind: string }) => c.kind === "int") ? "integer" : "number" };
  if (s instanceof z.ZodBoolean) return { type: "boolean" };
  if (s instanceof z.ZodEnum) return { type: "string", enum: def.values };
  if (s instanceof z.ZodArray) return { type: "array", items: jsonSchema(def.type) };
  if (s instanceof z.ZodObject) {
    const shape = s.shape as Record<string, ZodTypeAny>;
    const required = Object.entries(shape).filter(([, v]) => !v.isOptional() && !(v instanceof z.ZodDefault)).map(([k]) => k);
    return { type: "object", properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, jsonSchema(v)])), ...(required.length ? { required } : {}) };
  }
  return {};
}

const ERROR = { $ref: "#/components/schemas/Error" };

export function openApiSpec(origin = "") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const params = [...r.path.matchAll(/\{(.+?)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const query = r.query ? Object.entries((jsonSchema(r.query).properties ?? {}) as Record<string, unknown>).map(([name, schema]) => ({ name, in: "query", required: false, schema })) : [];
    (paths[r.path] ??= {})[r.method.toLowerCase()] = {
      tags: [r.tag], summary: r.summary, description: `Who: ${r.who}.`,
      parameters: [...params, ...query, ...(r.method === "POST" ? [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" } }] : [])],
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(r.body) } } } } : {}),
      responses: {
        [r.created ? "201" : "200"]: { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
        401: { description: "Missing or invalid token", content: { "application/json": { schema: ERROR } } },
        403: { description: "Not allowed", content: { "application/json": { schema: ERROR } } },
        404: { description: "Not found", content: { "application/json": { schema: ERROR } } },
        409: { description: "Conflicts with the current state", content: { "application/json": { schema: ERROR } } },
        422: { description: "Validation failed", content: { "application/json": { schema: ERROR } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Halden HRIS API", version: "1.0.0", description: "Employees, time, requests, leave and Philippine payroll. See docs/api.md." },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "A Supabase session JWT, or an API key (hk_live_…)." } },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: { type: "object", additionalProperties: { type: "string" } } } } } },
      },
    },
    paths,
  };
}
