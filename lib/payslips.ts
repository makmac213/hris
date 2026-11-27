// Issued payslips. When payroll is finalized, each person's payslip is saved as it was computed then,
// so what they see later never changes, even if time records, rates or settings change afterwards.
// Open periods are computed live and shown only as an estimate.

import type { Database, Employee, IssuedPayslip, PayrollPeriod } from "./types";
import { computePayslip, type Payslip } from "./payroll";

export const payslipId = (periodId: string, employeeId: string) => `${periodId}:${employeeId}`;

/** One saved payslip per person on the PH payroll, for a period being finalized. */
export function issuePayslips(db: Database, period: PayrollPeriod, nowIso: string, orgId: string): IssuedPayslip[] {
  const p = { ...period, status: "finalized" as const };
  return db.employees.flatMap((e) => {
    const s = computePayslip(db, e, p, nowIso);
    if (!s) return [];
    return [{ id: payslipId(p.id, e.id), organization_id: orgId, period_id: p.id, employee_id: e.id, issued_at: nowIso, gross: s.gross, net: s.net, data: JSON.parse(JSON.stringify(s)) }];
  });
}

/** The saved payslip for a closed period, or the live calculation for an open one. */
export function slipFor(db: Database, e: Employee, period: PayrollPeriod, nowIso: string): Payslip | null {
  if (period.status !== "open") {
    const row = (db.payslips ?? []).find((x) => x.period_id === period.id && x.employee_id === e.id);
    if (row) return { ...(row.data as Payslip), period };
  }
  return computePayslip(db, e, period, nowIso);
}

/** A person's issued payslips, newest first, and the current period's estimate if one is open. */
export function payslipsOf(db: Database, e: Employee, nowIso: string): { issued: Payslip[]; estimate: Payslip | null } {
  const periods = [...db.payroll_periods].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const issued = periods.filter((p) => p.status !== "open").map((p) => slipFor(db, e, p, nowIso)).filter((s): s is Payslip => !!s);
  const open = periods.find((p) => p.status === "open");
  return { issued, estimate: open ? computePayslip(db, e, open, nowIso) : null };
}
