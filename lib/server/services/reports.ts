import { availableReports, CATEGORY_LABEL, parseParams, runReport, viewerFor } from "@/lib/reports";
import { csvFilename, toCsv } from "@/lib/reports/csv";
import { type Ctx, requireScope } from "../context";
import { forbidden, notFound } from "../errors";

const viewer = (ctx: Ctx, db: Parameters<typeof viewerFor>[0]) => (ctx.principal.kind === "key" ? viewerFor(db, null, "key") : viewerFor(db, ctx.principal.employee));

export async function listReports(ctx: Ctx) {
  requireScope(ctx, "reports:read");
  const db = await ctx.repo.snapshot(ctx.orgId);
  return { data: availableReports(viewer(ctx, db)).map((r) => ({ key: r.key, title: r.title, category: r.category, category_label: CATEGORY_LABEL[r.category], description: r.description, filters: r.filters, sources: r.sources ?? [] })) };
}

/** A CSV answer: the HTTP layer sends it as text/csv instead of JSON. */
export interface CsvBody { __csv: string; filename: string }

export async function getReport(ctx: Ctx, key: string, query: Record<string, string>) {
  requireScope(ctx, "reports:read");
  const db = await ctx.repo.snapshot(ctx.orgId);
  const params = parseParams(db, ctx.now.slice(0, 10), query);
  const out = runReport(db, key, viewer(ctx, db), params, ctx.now);
  if (!out.ok) throw out.status === 404 ? notFound("Report") : forbidden(out.message);
  if (query.format === "csv") return { __csv: toCsv(out.result), filename: csvFilename(key, out.result.scope, ctx.now) } satisfies CsvBody;
  return { key, title: out.report.title, team_only: out.access === "team", params, ...out.result };
}
