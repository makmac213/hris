"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { finalizePayroll, useCurrentUser, useDb } from "@/lib/store";
import { displayName, formatDate } from "@/lib/format";
import { zoned } from "@/lib/time";
import { RULES, SOURCES, belowMinimumWage, computePayslip, peso, thirteenthMonthEstimate, type Payslip as PayslipData } from "@/lib/payroll";
import { Button, Dialog, EmptyState, Icon, PersonCell } from "@/components/ui";
import { Payslip } from "./Payslip";
import { PayrollSettingsDialog } from "./SettingsDialog";

export function PayrollView() {
  const db = useDb();
  const { employee: me, canManage } = useCurrentUser();
  const nowIso = new Date().toISOString();
  const today = zoned(Date.now()).date;
  const periods = [...db.payroll_periods].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const [periodId, setPeriodId] = useState(periods[0]?.id);
  const [open, setOpen] = useState<PayslipData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = db.payroll_settings;
  const period = periods.find((p) => p.id === periodId)!;

  const slips = useMemo(
    () => db.employees.map((e) => computePayslip(db, e, period, nowIso)).filter((s): s is PayslipData => !!s).sort((a, b) => displayName(a.employee).localeCompare(displayName(b.employee))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, period],
  );

  if (!canManage) {
    return <div className="page"><EmptyState title="Only admins and HR can run payroll" body="Your payslips are on the My pay page." action={<Link href="/my-pay" className="btn btn-secondary btn-md">Go to My pay</Link>} /></div>;
  }

  const sum = (f: (s: PayslipData) => number) => slips.reduce((n, s) => n + f(s), 0);
  const totals = {
    gross: sum((s) => s.gross),
    contrib: sum((s) => s.contributions.reduce((n, l) => n + l.amount, 0)),
    tax: sum((s) => s.tax),
    net: sum((s) => s.net),
    employer: sum((s) => s.employer.reduce((n, l) => n + l.amount, 0)),
    ot: sum((s) => s.earnings.filter((l) => l.key.startsWith("ot-")).reduce((n, l) => n + l.amount, 0)),
    other: sum((s) => s.otherDeductions.reduce((n, l) => n + l.amount, 0)),
  };
  const pending = sum((s) => s.pendingRequests);
  const flagged = slips.filter((s) => s.flags.some((f) => !f.includes("waiting for approval")));
  const notOnPayroll = db.employees.filter((e) => (e.status === "active" || e.status === "onboarding") && !db.compensation.some((c) => c.employee_id === e.id)).length;
  const cutoffPassed = today > period.end_date;
  const canFinalize = period.status === "open" && cutoffPassed && pending === 0 && !slips.some((s) => belowMinimumWage(s.comp, s.shift, settings));
  const finalizeBlock = period.status !== "open" ? null : !cutoffPassed ? `You can finalize after the cutoff on ${formatDate(period.end_date)}.` : pending ? `Decide the ${pending} pending ${pending === 1 ? "request" : "requests"} first.` : null;

  const year = Number(period.start_date.slice(0, 4));
  const thirteenth = db.compensation.reduce((n, c) => {
    const e = db.employees.find((x) => x.id === c.employee_id)!;
    return n + thirteenthMonthEstimate(c, db.shift_codes.find((s) => s.id === e.shift_code_id), e.start_date, year, settings);
  }, 0);

  const adj = (s: PayslipData) => s.earnings.filter((l) => l.key !== "basic" && !l.key.startsWith("ot-")).reduce((n, l) => n + l.amount, 0) - s.deductions.reduce((n, l) => n + l.amount, 0);
  const addOf = (s: PayslipData) => s.additions.reduce((n, l) => n + l.amount, 0);
  const otherOf = (s: PayslipData) => s.otherDeductions.reduce((n, l) => n + l.amount, 0);
  const otOf = (s: PayslipData) => s.earnings.filter((l) => l.key.startsWith("ot-")).reduce((n, l) => n + l.amount, 0);
  const basicOf = (s: PayslipData) => s.earnings.find((l) => l.key === "basic")?.amount ?? 0;

  return (
    <div className="page page-xl">
      <header className="page-head">
        <div>
          <h1>Payroll</h1>
          <p className="muted">
            Philippine payroll · {slips.length} people · paid twice a month
            {notOnPayroll > 0 && <> · {notOnPayroll} people outside the Philippines are paid by other payrolls</>}
          </p>
        </div>
        <div className="head-actions">
          <Link href="/payroll/pay-types" className="btn btn-secondary btn-md">Pay types</Link>
          <Button variant="secondary" onClick={() => setSettingsOpen(true)}>Payroll settings</Button>
        {period.status === "open" && (
          <div className="finalize">
            <Button variant="primary" disabled={!canFinalize} onClick={() => setConfirming(true)}>Finalize payroll</Button>
            {finalizeBlock && <span className="muted small">{finalizeBlock}</span>}
          </div>
        )}
        </div>
      </header>

      <div className="segmented-tabs" role="tablist" aria-label="Pay period">
        {periods.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={p.id === periodId} className={p.id === periodId ? "st st-on" : "st"} onClick={() => setPeriodId(p.id)}>
            {formatDate(p.start_date).replace(/, \d{4}$/, "")} – {formatDate(p.end_date).replace(/, \d{4}$/, "")}
            <span className={`st-tag st-${p.status}`}>{p.status === "open" ? "Open" : p.status === "finalized" ? "Finalized" : "Paid"}</span>
          </button>
        ))}
      </div>

      <section className="pay-summary" aria-label="Period totals">
        <div className="pay-hero">
          <span className="muted">{period.status === "open" ? "Projected net pay" : "Net pay"}, paid {formatDate(period.pay_date)}</span>
          <strong className="num">{peso(totals.net)}</strong>
        </div>
        <dl className="pay-facts">
          <div><dt>Gross</dt><dd className="num">{peso(totals.gross)}</dd></div>
          <div><dt>Approved overtime</dt><dd className="num">{peso(totals.ot)}</dd></div>
          <div><dt>Withholding tax</dt><dd className="num">{peso(totals.tax)}</dd></div>
          <div><dt>Employee contributions</dt><dd className="num">{peso(totals.contrib)}</dd></div>
          <div><dt>Employer contributions</dt><dd className="num">{peso(totals.employer)}</dd></div>
          <div><dt>Loans and other deductions</dt><dd className="num">{peso(totals.other)}</dd></div>
        </dl>
      </section>

      {(pending > 0 || flagged.length > 0) && period.status === "open" && (
        <div className="checks">
          {pending > 0 && (
            <p className="check check-warn"><Icon name="alert" size={18} /> <span>{pending} overtime or correction {pending === 1 ? "request is" : "requests are"} waiting. They aren’t paid until approved. <Link href="/approvals" className="link">Review requests</Link></span></p>
          )}
          {flagged.length > 0 && (
            <p className="check check-warn"><Icon name="alert" size={18} /> <span>{flagged.length} {flagged.length === 1 ? "payslip needs" : "payslips need"} a look: {flagged.map((s) => displayName(s.employee)).join(", ")}.</span></p>
          )}
        </div>
      )}
      {(() => {
        const below = slips.filter((s) => belowMinimumWage(s.comp, s.shift, settings));
        return below.length ? (
          <p className="check check-danger"><Icon name="alert" size={18} /> <span>{below.map((s) => displayName(s.employee)).join(", ")} {below.length === 1 ? "is" : "are"} paid below the {peso(settings.minimum_wage_daily)} daily minimum ({settings.minimum_wage_label}). Fix the rate before finalizing.</span></p>
        ) : (
          <p className="check check-ok"><Icon name="check" size={18} /> <span>Everyone is at or above the {peso(settings.minimum_wage_daily)} daily minimum ({settings.minimum_wage_label}).</span></p>
        );
      })()}
      {period.end_date.slice(5, 7) === "11" || period.end_date.slice(5, 7) === "12" ? (
        <p className="check"><Icon name="calendar" size={18} /> <span>13th month pay is due by December 24 (PD 851). Estimated total for {year}: <strong className="num">{peso(thirteenth)}</strong>. It is added automatically to the December 1–15 payroll (paid December 20), tax-free up to {peso(RULES.thirteenthMonthTaxFree)} a person together with other benefits.</span></p>
      ) : null}

      <div className="table-wrap section">
        <table className="table register">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="num r">Basic</th>
              <th className="num r col-md">Time and overtime</th>
              <th className="num r col-lg">Allowances</th>
              <th className="num r">Gross</th>
              <th className="num r col-lg">Contributions</th>
              <th className="num r col-lg">Tax</th>
              <th className="num r col-lg">Loans, other</th>
              <th className="num r">Net</th>
            </tr>
          </thead>
          <tbody>
            {slips.map((s) => (
              <tr key={s.employee.id} className="row-link" onClick={() => setOpen(s)}>
                <td>
                  <button type="button" className="row-btn" onClick={(e) => { e.stopPropagation(); setOpen(s); }}>
                    <PersonCell person={s.employee} sub={<>{s.comp.pay_basis === "monthly" ? "Monthly" : "Hourly"}{s.comp.is_managerial ? " · managerial" : ""}{s.flags.length ? <span className="text-warn"> · needs a look</span> : null}</>} />
                  </button>
                </td>
                <td className="num r">{peso(basicOf(s))}</td>
                <td className={`num r col-md ${adj(s) + otOf(s) < 0 ? "neg" : ""}`}>{adj(s) + otOf(s) ? (adj(s) + otOf(s) < 0 ? peso(adj(s) + otOf(s)) : `+${peso(adj(s) + otOf(s))}`) : "—"}</td>
                <td className="num r col-lg">{addOf(s) ? peso(addOf(s)) : "—"}</td>
                <td className="num r">{peso(s.gross)}</td>
                <td className="num r col-lg">{peso(s.contributions.reduce((n, l) => n + l.amount, 0))}</td>
                <td className="num r col-lg">{peso(s.tax)}</td>
                <td className="num r col-lg">{otherOf(s) ? peso(otherOf(s)) : "—"}</td>
                <td className="num r strong">{peso(s.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num r">{peso(sum(basicOf))}</td>
              <td className={`num r col-md ${sum(adj) + totals.ot < 0 ? "neg" : ""}`}>{peso(sum(adj) + totals.ot)}</td>
              <td className="num r col-lg">{peso(sum(addOf))}</td>
              <td className="num r">{peso(totals.gross)}</td>
              <td className="num r col-lg">{peso(totals.contrib)}</td>
              <td className="num r col-lg">{peso(totals.tax)}</td>
              <td className="num r col-lg">{peso(totals.other)}</td>
              <td className="num r strong">{peso(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <details className="rules section">
        <summary>Rules this payroll follows</summary>
        <ul>
          <li>Pay counts only time inside each person’s shift code, net of the unpaid meal break (Labor Code Art. 83 and 85). Late arrival, undertime and absences on scheduled days are unpaid, by the actual minute, with no fines on top. Undertime can’t be offset by overtime (Art. 88). Time not worked can’t take a cutoff’s basic pay below zero.</li>
          <li>Overtime is paid only when an overtime request is approved, and only for minutes the time records show were worked: +25% on regular days (Art. 87), +30% on top of the day rate on rest days and holidays.</li>
          <li>Rest day work is 130%. Special non-working days are 130% worked; unworked they are {settings.pay_unworked_special_days ? "paid, by company policy" : "unpaid (no work, no pay)"}. Regular holidays are 200% worked, and 100% unworked if the person was present on the workday before; with two holidays in a row, working the first keeps the second paid (Art. 93 and 94, Labor Advisory 12-25). Hours are classified by the calendar date they fall on, so a night shift that runs into a holiday gets the premium for the holiday hours only.</li>
          <li>Night shift differential is +10% of the rate that applies to those hours, between 10 PM and 6 AM (Art. 86). Managerial employees are excluded from overtime, night differential and holiday premiums (Art. 82){settings.deduct_managerial_tardiness ? "" : ", and their late arrival isn’t deducted"}.</li>
          <li>Monthly rates convert to daily at ×12 ÷ {settings.workdays_per_year}. Contributions are deducted {settings.contribution_timing === "split" ? "half each cutoff" : settings.contribution_timing === "second_cutoff" ? "on the 16th–end cutoff" : "on the 1st–15th cutoff"}: SSS 5% of the salary credit on {settings.sss_basis === "actual_compensation" ? "actual compensation" : "the monthly rate"}, PhilHealth 2.5% of basic salary, Pag-IBIG 2% up to ₱10,000. Withholding tax uses the BIR semi-monthly table on taxable pay after mandatory contributions; minimum wage earners are exempt on their wage, holiday pay, overtime and night differential.</li>
          <li>De minimis benefits are tax-free up to the RR 29-2025 ceilings (rice ₱2,500 a month, laundry ₱400 a month, uniform ₱8,000 a year, and others). 13th month pay and other benefits are tax-free up to ₱90,000 a year combined. Reimbursed, liquidated expenses aren’t compensation.</li>
          <li>Only deductions the law allows are taken (Art. 113): contributions, tax, SSS and Pag-IBIG loans, and anything else only with the employee’s signed authorization (DO 195-18). Loss or damage needs due process and is capped at 20% of wages (Art. 114–115). What pay can’t cover carries over; net pay never goes below zero.</li>
        </ul>
        <p className="muted small">Sources: {Object.values(SOURCES).map((s, i) => <span key={s.url}>{i > 0 && " · "}<a className="link" href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>)}</p>
      </details>

      {settingsOpen && <PayrollSettingsDialog onClose={() => setSettingsOpen(false)} />}
      {open && (
        <Dialog title={displayName(open.employee)} description={`${open.employee.job_title} · ${open.employee.employee_number}`} onClose={() => setOpen(null)} wide footer={<Button onClick={() => setOpen(null)}>Close</Button>}>
          <Payslip slip={open} showEmployer />
        </Dialog>
      )}
      {confirming && (
        <Dialog
          title={`Finalize ${formatDate(period.start_date)} – ${formatDate(period.end_date)}?`}
          description="Finalizing locks the period. Time records, overtime and corrections in it can’t change afterwards; fixes become adjustments in a later run."
          onClose={() => setConfirming(false)}
          footer={<><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button><Button variant="primary" onClick={() => { finalizePayroll(period.id, me.id); setConfirming(false); }}>Finalize {slips.length} payslips</Button></>}
        >
          <p>Net pay of <strong className="num">{peso(totals.net)}</strong> will be released on {formatDate(period.pay_date)}.</p>
        </Dialog>
      )}
    </div>
  );
}
