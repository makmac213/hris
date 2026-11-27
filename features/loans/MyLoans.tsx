"use client";

import { useState } from "react";
import { cancelLoanRequest, requestLoan, today, useCurrentUser, useDb } from "@/lib/store";
import { LOAN_KINDS, installmentAmount, loanSettings, loanSummary, openCompanyLoans, requestLimit, type LoanSummary } from "@/lib/loans";
import { peso } from "@/lib/payroll";
import { formatDate } from "@/lib/format";
import type { LoanKind } from "@/lib/types";
import { Button, Dialog, Field, Progress } from "@/components/ui";
import { Choice } from "@/features/payroll/SettingsDialog";
import { LoanStatus } from "./LoansView";

/** My pay: your loans and advances, and asking for one. */
export function MyLoans() {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const [asking, setAsking] = useState(false);
  const t = today();
  const mine = db.loans.filter((l) => l.employee_id === me.id).map((l) => loanSummary(db, l, t));
  const current = mine.filter((s) => ["requested", "active", "paused"].includes(s.status));
  const recent = mine.filter((s) => !current.includes(s) && (s.loan.decided_at ?? s.loan.created_at).slice(0, 10) >= `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`);
  const policy = loanSettings(db);
  const blocked = policy.one_open_at_a_time && openCompanyLoans(db, me.id, t).length > 0;

  return (
    <section className="panel no-print my-loans">
      <div className="panel-head">
        <h2>Loans and advances</h2>
        {policy.allow_requests && !me.end_date && <Button size="sm" onClick={() => setAsking(true)} disabled={blocked}>Ask for an advance or loan</Button>}
      </div>
      {blocked && <p className="muted small">You can have one company loan, advance or request open at a time.</p>}
      {current.length + recent.length === 0 ? (
        <p className="muted">No loans or advances. SSS and Pag-IBIG loans you take show here once HR enters them from the agency billing.</p>
      ) : (
        <div className="req-list">
          {[...current, ...recent].map((s) => <LoanRow key={s.loan.id} s={s} />)}
        </div>
      )}
      {asking && <RequestDialog onClose={() => setAsking(false)} />}
    </section>
  );
}

function LoanRow({ s }: { s: LoanSummary }) {
  const n = s.loan.requested_installments;
  const sub = s.status === "requested"
    ? `${peso(s.loan.principal)} over ${n} cutoff${n === 1 ? "" : "s"}, asked ${formatDate((s.loan.requested_at ?? s.loan.created_at).slice(0, 10))}. HR decides.`
    : s.status === "rejected" || s.status === "cancelled"
      ? `${peso(s.loan.principal)}${s.loan.decision_note ? `. ${s.loan.decision_note}` : ""}`
      : s.status === "paid" ? `${peso(s.loan.principal)} repaid in full`
      : `${peso(s.balance)} left of ${peso(s.loan.principal)}${s.next ? ` · next ${peso(s.next.amount)} on ${formatDate(s.next.period.pay_date)}` : ""}${s.lastDeduction && s.status === "active" ? ` · last on ${formatDate(s.lastDeduction.pay_date)}` : ""}`;
  return (
    <div className="req">
      <div className="req-main">
        <strong>{s.info.label}{s.loan.purpose && !s.info.agency ? `: ${s.loan.purpose}` : ""}{s.loan.reference_no ? <span className="muted"> · {s.loan.reference_no}</span> : null}</strong>
        <span className="muted small">{sub}</span>
        {(s.status === "active" || s.status === "paused") && <Progress value={Math.min(s.repaid, s.loan.principal)} max={s.loan.principal} label={`${Math.round((s.repaid / s.loan.principal) * 100)}% repaid`} />}
      </div>
      <div className="req-side">
        <LoanStatus status={s.status} />
        {s.status === "requested" && <Button size="sm" variant="ghost" onClick={() => cancelLoanRequest(s.loan.id)}>Withdraw</Button>}
      </div>
    </div>
  );
}

function RequestDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const policy = loanSettings(db);
  const [kind, setKind] = useState<LoanKind>("cash_advance");
  const [amount, setAmount] = useState("");
  const [n, setN] = useState("2");
  const [purpose, setPurpose] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const max = requestLimit(db, me.id, kind);
  const amt = Number(amount.replace(/[,₱\s]/g, ""));
  const cutoffs = Number(n);
  const preview = Number.isFinite(amt) && amt > 0 && Number.isInteger(cutoffs) && cutoffs > 0 ? installmentAmount(amt, cutoffs) : null;
  const send = () => {
    const r = requestLoan(me.id, { kind, amount: amt, installments: cutoffs, purpose });
    if (!r.loan) return setErrors(r.errors);
    onClose();
  };
  return (
    <Dialog title="Ask for an advance or loan" description="Goes to HR. If approved, you sign a salary deduction authorization and payroll deducts it each cutoff." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={send}>Send request</Button></>}>
      <div className="form-grid">
        {errors.body && <p className="callout-warn span-2">{errors.body}</p>}
        <Choice legend="What you need" value={kind} onChange={(v) => { setKind(v); setErrors({}); }} options={(["cash_advance", "company_loan"] as const).map((k) => ({ value: k, label: LOAN_KINDS[k].label }))} hint={errors.kind} />
        <Field label="Amount" hint={errors.amount ? undefined : `Up to ${peso(max)}.`} error={errors.amount}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} />}
        </Field>
        <Field label="Repay over, in cutoffs" hint={errors.installments ? undefined : preview ? `${peso(preview)} deducted each cutoff` : `1 to ${policy.max_installments}. Two cutoffs a month.`} error={errors.installments}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={n} onChange={(ev) => setN(ev.target.value)} />}
        </Field>
        <div className="span-2"><Field label="What it's for" error={errors.purpose}>{(id, d) => <input id={id} aria-describedby={d} value={purpose} onChange={(ev) => setPurpose(ev.target.value)} />}</Field></div>
      </div>
    </Dialog>
  );
}
