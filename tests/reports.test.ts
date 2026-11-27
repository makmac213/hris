import { test } from "node:test";
import assert from "node:assert/strict";
import { REPORTS, availableReports, parseParams, runReport, viewerFor } from "@/lib/reports";
import { toCsv } from "@/lib/reports/csv";
import { diffDatabases } from "@/lib/audit";
import { seed } from "@/lib/mock-data";
import type { Database } from "@/lib/types";
import { displayName } from "@/lib/format";

const now = new Date().toISOString();
const today = now.slice(0, 10);
const who = (id: string) => viewerFor(seed, seed.employees.find((e) => e.id === id)!);
const run = (key: string, id: string, q: Record<string, string> = {}) => runReport(seed, key, who(id), parseParams(seed, today, q), now);

test("every report runs for admin and returns consistent columns", () => {
  for (const r of REPORTS) {
    const out = run(r.key, "e04", { from: "2026-01-01" });
    assert.ok(out.ok, r.key);
    if (!out.ok) continue;
    const keys = new Set(out.result.columns.map((c) => c.key));
    for (const row of out.result.rows) for (const k of Object.keys(row)) assert.ok(keys.has(k), `${r.key}: unexpected column ${k}`);
  }
});

test("who sees what: executives get aggregates, not pay; HR can't read the audit trail; employees get nothing", () => {
  const keys = (id: string) => availableReports(who(id)).map((r) => r.key);
  assert.ok(keys("e01").includes("executive") && keys("e01").includes("headcount"));
  assert.ok(!keys("e01").includes("payroll-register") && !keys("e01").includes("audit-trail"));
  const own = run("attendance", "e01");
  assert.ok(own.ok && own.access === "team", "the CEO manages people, so sees their direct reports' attendance only");
  assert.ok(keys("e10").includes("payroll-register") && !keys("e10").includes("audit-trail"));
  assert.ok(keys("e04").includes("audit-trail"));
  const plain = seed.employees.find((e) => e.role === "employee" && !seed.employees.some((x) => x.manager_id === e.id))!;
  assert.deepEqual(keys(plain.id), [], plain.id);
  assert.ok(keys("e40").includes("attendance") && !keys("e40").includes("payroll-register"), "operations");
  const denied = run("payroll-register", "e01");
  assert.ok(!denied.ok && denied.status === 403);
});

test("managers see only their direct reports", () => {
  const out = run("attendance", "e41");
  assert.ok(out.ok && out.access === "team");
  const team = new Set(seed.employees.filter((e) => e.manager_id === "e41").map(displayName));
  assert.ok(out.ok && out.result.rows.length > 0);
  if (out.ok) for (const r of out.result.rows) assert.ok(team.has(String(r.name)), `${r.name} isn't on e41's team`);
});

test("headcount and turnover agree with the people list", () => {
  const h = run("headcount", "e04");
  assert.ok(h.ok);
  const active = seed.employees.filter((e) => e.start_date <= today && (!e.end_date || e.end_date >= today)).length;
  assert.equal(h.ok && h.result.totals!.headcount, active);
  const t = run("turnover", "e04", { from: "2026-01-01", to: "2026-12-31" });
  assert.ok(t.ok);
  assert.equal(t.ok && t.result.rows.length, seed.employees.filter((e) => e.end_date && e.end_date.startsWith("2026")).length);
});

test("payroll register totals match the issued payslips; contributions are both shares", () => {
  const r = run("payroll-register", "e10");
  assert.ok(r.ok);
  if (!r.ok) return;
  const period = seed.payroll_periods.find((p) => p.status !== "open")!;
  const issued = seed.payslips.filter((x) => x.period_id === period.id).reduce((n, x) => n + x.net, 0);
  assert.ok(Math.abs((r.result.totals!.net as number) - issued) < 0.05, `${r.result.totals!.net} vs ${issued}`);
  const c = run("contributions", "e10");
  assert.ok(c.ok && c.result.rows.every((x) => (x.sss_er as number) >= (x.sss_ee as number)), "SSS employer share is at least the employee share");
});

test("CSV export quotes commas and neutralizes formulas", () => {
  const csv = toCsv({ scope: "", columns: [{ key: "a", label: "Name, full", kind: "text" }, { key: "b", label: "Net", kind: "money" }], rows: [{ a: "=HYPERLINK(\"x\")", b: 1234.5 }, { a: "Cruz, Ana", b: 10 }] });
  assert.equal(csv, "\"Name, full\",Net\r\n\"'=HYPERLINK(\"\"x\"\")\",1234.50\r\n\"Cruz, Ana\",10\r\n");
});

test("the audit log records who changed which field", () => {
  const next: Database = { ...seed, employees: seed.employees.map((e) => (e.id === "e16" ? { ...e, job_title: "Senior Software Engineer" } : e)) };
  const [entry, ...rest] = diffDatabases(seed, next, { id: "e10", label: "Leah Santos" }, now, () => "a1", "o");
  assert.equal(rest.length, 0);
  assert.equal(entry.action, "update");
  assert.equal(entry.actor_label, "Leah Santos");
  assert.deepEqual(entry.changes, [{ field: "job_title", from: "Software Engineer", to: "Senior Software Engineer" }]);
  const audit = run("audit-trail", "e04", { from: "2020-01-01" });
  assert.ok(audit.ok && audit.result.rows.length > 0);
});
