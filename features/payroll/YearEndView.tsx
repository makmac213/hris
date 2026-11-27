"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCurrentUser, useDb } from "@/lib/store";
import { displayName, formatDate } from "@/lib/format";
import { zoned } from "@/lib/time";
import { peso as pesoExact } from "@/lib/payroll";

// Whole pesos keep the register readable; the 2316 dialog shows centavos.
const peso = (n: number) => pesoExact(Math.round(n)).replace(/\.00$/, "");
import { ANNUAL_TAX_TABLE, annualSummary, yearEndDeadlines, type AnnualSummary } from "@/lib/yearend";
import { Button, Dialog, EmptyState, Icon, PersonCell } from "@/components/ui";

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", timeZone: "UTC" });

export function YearEndView() {
  const db = useDb();
  const { canManage } = useCurrentUser();
  const today = zoned(Date.now()).date;
  const year = Number(today.slice(0, 4));
  const [open, setOpen] = useState<AnnualSummary | null>(null);
  const nowIso = new Date().toISOString();
  const rows = useMemo(() => db.employees.map((e) => annualSummary(db, e, year, nowIso)).filter((x): x is AnnualSummary => !!x), [db, year]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!canManage) return <div className="page"><EmptyState title="Only admins and HR can see year-end tax" body="Your BIR Form 2316 will be on the My pay page after January 31." /></div>;

  const sum = (f: (r: AnnualSummary) => number) => rows.reduce((n, r) => n + f(r), 0);
  const months = new Map<string, { gross: number; tax: number }>();
  for (const r of rows) for (const m of r.months) { const x = months.get(m.month) ?? { gross: 0, tax: 0 }; x.gross += m.gross; x.tax += m.tax; months.set(m.month, x); }
  const refunds = rows.filter((r) => r.decemberAdjustment < 0);

  return (
    <div className="page page-xl">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/payroll">Payroll</Link>
        <Icon name="chevronRight" size={14} />
        <span aria-current="page">Year-end tax</span>
      </nav>
      <header className="page-head">
        <div>
          <h1>Year-end tax, {year}</h1>
          <p className="muted">The December 16–31 payroll annualizes each person’s tax: it withholds what’s still due on the year’s income, or refunds what was over-withheld. Figures for periods still to come are projected from schedules.</p>
        </div>
      </header>

      <section className="section">
        <h2>Deadlines</h2>
        <div className="deadlines">
          {yearEndDeadlines(year).map((d) => (
            <div key={d.form} className="deadline">
              <strong>{d.form}</strong>
              <span className="num">{/^\d{4}-/.test(d.due) ? formatDate(d.due) : d.due}</span>
              <p className="muted small">{d.what}. {d.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>By employee</h2></div>
        {refunds.length > 0 && <p className="check check-ok small"><Icon name="check" size={18} /> <span>{refunds.length} {refunds.length === 1 ? "person gets" : "people get"} a refund of excess withholding in the December 16–31 payroll: {refunds.map((r) => `${displayName(r.employee)} (${peso(-r.decemberAdjustment)})`).join(", ")}.</span></p>}
        <div className="table-wrap">
          <table className="table register">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col" className="num r col-lg">Gross</th>
                <th scope="col" className="num r col-lg">Non-taxable</th>
                <th scope="col" className="num r">Taxable</th>
                <th scope="col" className="num r">Tax due</th>
                <th scope="col" className="num r col-md">Withheld to Dec 15</th>
                <th scope="col" className="num r">Dec 16–31 adjustment</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee.id}>
                  <td><PersonCell person={r.employee} sub={[r.mwe ? "Minimum wage earner" : null, r.substitutedFiling ? "Substituted filing" : "Joined this year: check for a previous employer"].filter(Boolean).join(" · ")} /></td>
                  <td className="num r col-lg">{peso(r.gross)}</td>
                  <td className="num r col-lg">{peso(r.nonTaxable + r.mandatory)}</td>
                  <td className="num r">{peso(r.taxable)}</td>
                  <td className="num r">{peso(r.taxDue)}</td>
                  <td className="num r col-md">{peso(r.taxWithheld - r.decemberAdjustment)}</td>
                  <td className={`num r ${r.decemberAdjustment < 0 ? "text-ok" : ""}`}>{r.decemberAdjustment < 0 ? `Refund ${peso(-r.decemberAdjustment)}` : peso(r.decemberAdjustment)}</td>
                  <td className="r"><Button size="sm" variant="ghost" onClick={() => setOpen(r)}>2316</Button></td>
                </tr>
              ))}
              <tr className="pay-subtotal">
                <td>Total</td>
                <td className="num r col-lg">{peso(sum((r) => r.gross))}</td>
                <td className="num r col-lg">{peso(sum((r) => r.nonTaxable + r.mandatory))}</td>
                <td className="num r">{peso(sum((r) => r.taxable))}</td>
                <td className="num r">{peso(sum((r) => r.taxDue))}</td>
                <td className="num r col-md">{peso(sum((r) => r.taxWithheld - r.decemberAdjustment))}</td>
                <td className="num r">{peso(sum((r) => r.decemberAdjustment))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">Figures through {formatDate(db.payroll_openings[0]?.through_date ? db.payroll_openings[0].through_date : `${year}-01-01`)} were imported from the previous payroll provider at go-live. The 1604-C alphalist lists the same rows.</p>
      </section>

      <section className="section">
        <h2>Monthly remittances (BIR Form 1601-C)</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Month</th><th scope="col" className="num r">Compensation paid</th><th scope="col" className="num r">Tax withheld</th><th scope="col">Due</th></tr></thead>
            <tbody>
              {[...months.entries()].map(([m, x]) => (
                <tr key={m}><td>{monthName(m)}</td><td className="num r">{peso(x.gross)}</td><td className="num r">{peso(x.tax)}</td><td className="num">{formatDate(nextMonth10(m))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>How tax is annualized</h2>
        <p className="muted">Taxable compensation for the year is gross pay less non-taxable items: 13th month and other benefits up to ₱90,000, de minimis benefits within their ceilings, and the employee’s SSS, PhilHealth and Pag-IBIG shares and union dues. Tax due uses the annual table (NIRC Sec. 24(A), 2023 onward):</p>
        <ul className="muted small">
          {ANNUAL_TAX_TABLE.map((r, i) => <li key={i}>{i === 0 ? `Up to ${peso(ANNUAL_TAX_TABLE[1].over)}: exempt` : `Over ${peso(r.over)}: ${peso(r.fixed)} + ${r.rate * 100}% of the excess`}</li>)}
        </ul>
      </section>

      {open && <Form2316 s={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function nextMonth10(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm, 10)).toISOString().slice(0, 10);
}

function Form2316({ s, onClose }: { s: AnnualSummary; onClose: () => void }) {
  const row = (label: string, v: number, strong = false) => <tr className={strong ? "pay-subtotal" : ""}><td>{label}</td><td className="num r">{pesoExact(v)}</td></tr>;
  return (
    <Dialog wide title={`BIR Form 2316 figures: ${displayName(s.employee)}`} description={`Calendar year ${s.year}${s.estimated ? ". Estimate until December is paid." : ""}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <table className="table fp-table">
        <tbody>
          {row("Gross compensation income", s.gross)}
          {row("Non-taxable: 13th month and other benefits, de minimis, reimbursements", s.nonTaxable)}
          {row("Non-taxable: SSS, PhilHealth, Pag-IBIG employee shares and union dues", s.mandatory)}
          {row("Taxable compensation income", s.taxable, true)}
          {row("Tax due", s.taxDue)}
          {row("Tax withheld, January to December 15", s.taxWithheld - s.decemberAdjustment)}
          {row(s.decemberAdjustment < 0 ? "Refunded in the December 16–31 payroll" : "Withheld in the December 16–31 payroll", Math.abs(s.decemberAdjustment))}
          {row("Total tax withheld", s.taxWithheld, true)}
        </tbody>
      </table>
      <p className="muted small">{s.substitutedFiling ? "Qualifies for substituted filing: one employer all year with tax correctly withheld, so the signed 2316 serves as the annual return (RR 11-2018)." : "Doesn't qualify for substituted filing on this record (joined mid-year or has another employer). They may need to file BIR Form 1700."}</p>
    </Dialog>
  );
}
