"use client";

import { useMemo, useState } from "react";
import { useCurrentUser, useDb } from "@/lib/store";
import { displayName, formatDate } from "@/lib/format";
import { peso } from "@/lib/payroll";
import { payslipsOf } from "@/lib/payslips";
import { Button, EmptyState } from "@/components/ui";
import { Payslip } from "./Payslip";

const range = (start: string, end: string) => `${formatDate(start).replace(/, \d{4}$/, "")} – ${formatDate(end)}`;

/** Your payslips. Issued ones are saved when payroll is finalized and don't change; the open period is an estimate. */
export function MyPayView() {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const { issued, estimate } = useMemo(() => payslipsOf(db, me, new Date().toISOString()), [db, me]);
  const [sel, setSel] = useState<string | null>(null);

  if (!issued.length && !estimate) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>My pay</h1></div></header>
        <EmptyState title="You’re not on the Philippine payroll" body="Payslips here are for employees paid in the Philippines. Your local payroll provider sends yours." />
      </div>
    );
  }

  const all = [...issued, ...(estimate ? [estimate] : [])];
  const slip = all.find((s) => s.period.id === sel) ?? issued[0] ?? estimate!;
  const isEstimate = slip.period.status === "open";
  const printSlip = () => {
    document.querySelectorAll<HTMLDetailsElement>("details.days").forEach((d) => { d.open = true; });
    window.print();
  };

  return (
    <div className="page">
      <header className="page-head no-print">
        <div>
          <h1>My pay</h1>
          <p className="muted">Paid on the 20th for the 1st–15th, and on the 5th for the 16th to month end. A payslip is issued when payroll for the period is finalized.</p>
        </div>
      </header>
      <div className="pay-layout">
        <nav className="pay-periods no-print" aria-label="Payslips">
          <h2 className="pay-periods-head">Payslips</h2>
          {issued.length === 0 && <p className="muted small">None issued yet.</p>}
          {issued.map((s) => (
            <button key={s.period.id} type="button" className={`pay-period ${s === slip ? "pay-period-on" : ""}`} aria-current={s === slip ? "true" : undefined} onClick={() => setSel(s.period.id)}>
              <span>{range(s.period.start_date, s.period.end_date)}</span>
              <span className="muted num">{peso(s.net)} · {s.period.status === "paid" ? `paid ${formatDate(s.period.pay_date)}` : `pay day ${formatDate(s.period.pay_date)}`}</span>
            </button>
          ))}
          {estimate && (
            <>
              <h2 className="pay-periods-head">This period, so far</h2>
              <button type="button" className={`pay-period ${estimate === slip ? "pay-period-on" : ""}`} aria-current={estimate === slip ? "true" : undefined} onClick={() => setSel(estimate.period.id)}>
                <span>{range(estimate.period.start_date, estimate.period.end_date)}</span>
                <span className="muted num">Estimate {peso(estimate.net)}</span>
              </button>
            </>
          )}
        </nav>
        <section className="panel payslip-panel">
          <div className="payslip-actions no-print">
            {isEstimate
              ? <span className="muted small">An estimate, not a payslip. You can print it once payroll is finalized.</span>
              : <Button icon="download" onClick={printSlip}>Print or save as PDF</Button>}
          </div>
          <div className="print-only payslip-print-head">
            <strong>Halden</strong>
            <span>Payslip for {displayName(slip.employee)} · {slip.employee.employee_number} · {slip.employee.job_title}</span>
          </div>
          <Payslip slip={slip} showEmployer={false} />
        </section>
      </div>
    </div>
  );
}
