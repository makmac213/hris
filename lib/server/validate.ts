import { z, type ZodTypeAny } from "zod";
import { invalid } from "./errors";

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const details: Record<string, string> = {};
  for (const issue of r.error.issues) details[issue.path.join(".") || "body"] ??= issue.message;
  throw invalid(details);
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-27.");
export const isoInstant = z.string().refine((s) => !Number.isNaN(Date.parse(s)) && /T/.test(s), "Use an ISO 8601 time with an offset.");
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** Cursor pagination over rows sorted by id. */
export function paginate<T extends { id: string }>(rows: T[], q: { limit: number; cursor?: string }) {
  const after = q.cursor ? Buffer.from(q.cursor, "base64url").toString() : null;
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => !after || r.id > after);
  const page = sorted.slice(0, q.limit);
  return { data: page, next_cursor: sorted.length > q.limit ? Buffer.from(page[page.length - 1].id).toString("base64url") : null };
}
