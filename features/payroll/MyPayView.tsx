"use client";

import { useMemo, useState } from "react";
import { useCurrentUser, useDb } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { computePayslip, peso } from "@/lib/payroll";
import { EmptyState } from "@/components/ui";
import { Payslip } from "./Payslip";

export function MyPayView() {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const nowIso = new Date().toISOString();
  const periods = useMemo(() => [...db.payroll_periods].sort((a, b) => b.start_date.localeCompare(a.start_date)), [db.payroll_periods]);
  const slips = useMemo(
    () => periods.map((p) => computePayslip(db, me, p, nowIso)).filter((s): s is NonNullable<typeof s> => !!s),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, me, periods],
  );
  const [sel, setSel] = useState(0);

  if (!slips.length) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>My pay</h1></div></header>
        <EmptyState title="You’re not on the Philippine payroll" body="Payslips here are for employees paid in the Philippines. Your local payroll provider sends yours." />
      </div>
    );
  }
  const slip = slips[Math.min(sel, slips.length - 1)];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>My pay</h1>
          <p className="muted">Paid on the 20th for the 1st–15th, and on the 5th for the 16th to month end.</p>
        </div>
      </header>
      <div className="pay-layout">
        <nav className="pay-periods" aria-label="Payslips">
          {slips.map((s, i) => (
            <button key={s.period.id} type="button" className={`pay-period ${i === sel ? "pay-period-on" : ""}`} aria-current={i === sel ? "true" : undefined} onClick={() => setSel(i)}>
              <span>{formatDate(s.period.start_date).replace(/, \d{4}$/, "")} – {formatDate(s.period.end_date)}</span>
              <span className="muted num">{s.period.status === "open" ? "Projected " : ""}{peso(s.net)}</span>
            </button>
          ))}
        </nav>
        <section className="panel"><Payslip slip={slip} showEmployer={false} /></section>
      </div>
    </div>
  );
}
