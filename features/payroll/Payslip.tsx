"use client";

import { displayName, formatDate } from "@/lib/format";
import { formatDuration } from "@/lib/time";
import { peso, type DayCalc, type Payslip as PayslipData } from "@/lib/payroll";
import { Blank } from "@/components/ui";

const dayTypeLabel: Record<DayCalc["type"], string> = {
  ordinary: "", rest: "Rest day", regular: "Regular holiday", special: "Special day", regular_rest: "Regular holiday, rest day", special_rest: "Special day, rest day",
};

export function Payslip({ slip, showEmployer }: { slip: PayslipData; showEmployer: boolean }) {
  const totalContrib = slip.contributions.filter((l) => l.key !== "pagibig-voluntary").reduce((n, l) => n + l.amount, 0);
  const open = slip.period.status === "open";

  return (
    <div className="payslip">
      <div className="payslip-net">
        <span className="muted">{open ? "Projected net pay" : "Net pay"}</span>
        <strong className="num">{peso(slip.net)}</strong>
        <span className="muted">
          {formatDate(slip.period.start_date)} – {formatDate(slip.period.end_date)} · paid {formatDate(slip.period.pay_date)}
        </span>
      </div>

      {open && <p className="callout-info">This period is still open. Days that haven’t happened yet are projected as fully worked, and pending requests aren’t counted until they’re approved.</p>}
      {slip.flags.length > 0 && (
        <ul className="flags">
          {slip.flags.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}

      <table className="table pay-table">
        <tbody>
          <tr className="pay-group"><th colSpan={2}>Earnings</th></tr>
          {slip.earnings.map((l) => <PayRow key={l.key} label={l.label} detail={l.detail} amount={l.amount} />)}
          {slip.deductions.length > 0 && <tr className="pay-group"><th colSpan={2}>Time not worked</th></tr>}
          {slip.deductions.map((l) => <PayRow key={l.key} label={l.label} detail={l.detail} amount={-l.amount} />)}
          {slip.additions.length > 0 && <tr className="pay-group"><th colSpan={2}>Allowances and benefits</th></tr>}
          {slip.additions.map((l) => <PayRow key={l.key} label={l.label} detail={l.detail} amount={l.amount} />)}
          <tr className="pay-subtotal"><td>Gross pay</td><td className="num amount">{peso(slip.gross)}</td></tr>
          {slip.contributions.length > 0 && <tr className="pay-group"><th colSpan={2}>Government contributions</th></tr>}
          {slip.contributions.map((l) => <PayRow key={l.key} label={l.label} detail={l.detail} amount={-l.amount} />)}
          <tr className="pay-group"><th colSpan={2}>Tax</th></tr>
          <PayRow
            label="Withholding tax"
            detail={slip.mwe ? (slip.taxable > 0 ? `Minimum wage earner: wage, holiday pay and overtime exempt; ${peso(slip.taxable)} of other pay taxed` : "Minimum wage earner: exempt") : `Semi-monthly table on ${peso(slip.taxable)} taxable`}
            amount={-slip.tax}
          />
          {slip.otherDeductions.length > 0 && <tr className="pay-group"><th colSpan={2}>Loans and other deductions</th></tr>}
          {slip.otherDeductions.map((l) => <PayRow key={l.key} label={l.label} detail={l.detail} amount={-l.amount} />)}
          <tr className="pay-total"><td>Net pay</td><td className="num amount">{peso(slip.net)}</td></tr>
        </tbody>
      </table>
      <p className="muted small">
        {slip.mwe ? "Taxable pay is pay other than the minimum wage, holiday pay, overtime and night differential." : <>Taxable pay is gross pay less mandatory contributions ({peso(totalContrib)}) and tax-free items.</>}
        {slip.nonTaxable > 0 && <> Not taxed: {peso(slip.nonTaxable)} (de minimis within the RR 29-2025 ceilings, benefits within the ₱90,000 yearly limit, reimbursements).</>}
      </p>
      {slip.employer.some((l) => l.key.endsWith("-ee-by-er")) && (
        <p className="muted small">
          The company pays the employee share of {slip.employer.filter((l) => l.key.endsWith("-ee-by-er")).map((l) => l.label.split(" ")[0]).join(", ")} ({peso(slip.employer.filter((l) => l.key.endsWith("-ee-by-er")).reduce((n, l) => n + l.amount, 0))}). It isn’t deducted, and it counts as taxable pay.
        </p>
      )}
      {slip.deferred.length > 0 && (
        <p className="muted small">Carried to the next cutoff: {slip.deferred.map((l) => `${l.label} ${peso(l.amount)}`).join(" · ")}.</p>
      )}

      {showEmployer && slip.employer.length > 0 && (
        <p className="muted small">
          Employer cost this cutoff: {slip.employer.map((l) => `${l.label} ${peso(l.amount)}`).join(" · ")}.
        </p>
      )}

      <details className="days">
        <summary>Day-by-day time used for this payslip</summary>
        <table className="table">
          <thead><tr><th>Date</th><th className="num">Paid time</th><th>Notes</th></tr></thead>
          <tbody>
            {slip.days.filter((d) => d.scheduledMin || d.otMin || d.holiday).map((d) => (
              <tr key={d.date}>
                <td className="num">{formatDate(d.date)}{dayTypeLabel[d.type] && <span className="muted"> · {dayTypeLabel[d.type]}</span>}</td>
                <td className="num">{d.future ? <span className="muted">Projected</span> : formatDuration(d.workedMin + d.otMin)}</td>
                <td>
                  {[
                    d.absent && "Absent",
                    d.incomplete && "No time out",
                    d.lateMin > 0 && !d.incomplete && `Late ${formatDuration(d.lateMin)}`,
                    d.undertimeMin > 0 && !d.incomplete && `Undertime ${formatDuration(d.undertimeMin)}`,
                    d.otMin > 0 && `Approved OT ${formatDuration(d.otMin)}`,
                    d.pendingOtMin > 0 && `OT pending ${formatDuration(d.pendingOtMin)}`,
                    d.unapprovedExtraMin > 0 && `${formatDuration(d.unapprovedExtraMin)} outside schedule, not filed`,
                    d.nsdMin > 0 && `Night ${formatDuration(d.nsdMin)}`,
                    d.holidayPaidUnworked && "Paid holiday",
                    d.specialUnworked && (slip.settings.pay_unworked_special_days ? "Special day off, paid by policy" : "Special day off, unpaid"),
                    d.type === "regular" && !d.holidayPaidUnworked && !d.workedMin && !d.future && !slip.comp.is_managerial && "Holiday unpaid: absent the workday before",
                  ].filter(Boolean).join(" · ") || <Blank />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="muted small">Prepared for {displayName(slip.employee)} · {slip.employee.employee_number}</p>
    </div>
  );
}

function PayRow({ label, detail, amount }: { label: string; detail?: string; amount: number }) {
  return (
    <tr>
      <td>
        <span className="cell-2"><span>{label}</span>{detail && <span className="muted">{detail}</span>}</span>
      </td>
      <td className={`num amount ${amount < 0 ? "neg" : ""}`}>{amount < 0 ? `−${peso(-amount)}` : peso(amount)}</td>
    </tr>
  );
}
