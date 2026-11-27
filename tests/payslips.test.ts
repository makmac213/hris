import { test } from "node:test";
import assert from "node:assert/strict";
import { issuePayslips, payslipsOf, slipFor } from "@/lib/payslips";
import { ORG_ID, seed } from "@/lib/mock-data";
import type { Database } from "@/lib/types";

const now = new Date().toISOString();
const e = seed.employees.find((x) => x.id === "e19")!;
const closed = seed.payroll_periods.find((p) => p.status !== "open")!;

test("the seed issued payslips for the finalized period", () => {
  assert.ok(seed.payslips.some((x) => x.period_id === closed.id && x.employee_id === "e19"));
  const { issued, estimate } = payslipsOf(seed, e, now);
  assert.equal(issued[0].period.id, closed.id);
  assert.equal(estimate?.period.status, "open");
});

test("an issued payslip doesn't change when the data behind it does", () => {
  const before = slipFor(seed, e, closed, now)!;
  // Wipe e19's time in that period: a live calculation would show absences.
  const changed: Database = { ...seed, time_records: seed.time_records.filter((r) => !(r.employee_id === "e19" && r.work_date >= closed.start_date && r.work_date <= closed.end_date)) };
  assert.equal(slipFor(changed, e, closed, now)!.net, before.net);
  const live = issuePayslips(changed, closed, now, ORG_ID).find((x) => x.employee_id === "e19")!;
  assert.ok(live.net < before.net, "recomputing would have lowered it");
});

test("the saved copy shows the period's current status", () => {
  const paid = { ...closed, status: "paid" as const };
  const db: Database = { ...seed, payroll_periods: seed.payroll_periods.map((p) => (p.id === closed.id ? paid : p)) };
  assert.equal(slipFor(db, e, paid, now)!.period.status, "paid");
});
