"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { decideLoan, recordLoanPayment, saveLoan, today, updateLoan, updateLoanSettings, useCurrentUser, useDb } from "@/lib/store";
import { LOAN_KINDS, LOAN_KIND_LIST, SCHEDULE_LABEL, installmentAmount, loanSummary, monthlyBasic, perCutoff, type LoanSummary } from "@/lib/loans";
import { peso } from "@/lib/payroll";
import { displayName, formatDate } from "@/lib/format";
import type { ContributionTiming, Employee, Loan, LoanKind, LoanPaymentMethod } from "@/lib/types";
import { Blank, Button, Dialog, EmptyState, Field, FilterSelect, Icon, PersonCell, Progress, SearchInput } from "@/components/ui";
import { Choice, Toggle } from "@/features/payroll/SettingsDialog";

type ShownStatus = LoanSummary["status"];
export const STATUS_LABEL: Record<ShownStatus, string> = { requested: "Waiting for HR", active: "Active", paused: "Paused", paid: "Paid", stopped: "Stopped", rejected: "Rejected", cancelled: "Withdrawn" };
const STATUS_CLASS: Partial<Record<ShownStatus, string>> = { requested: "badge-onboarding", paused: "badge-on_leave", paid: "badge-active", stopped: "badge-offboarded", rejected: "badge-offboarded", cancelled: "badge-offboarded" };
export const LoanStatus = ({ status }: { status: ShownStatus }) => (status === "active" ? <span className="muted">Active</span> : <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>);

const money = (v: string) => Number(v.replace(/[,₱\s]/g, ""));
const loanTitle = (l: Loan) => (l.purpose && !LOAN_KINDS[l.kind].agency ? `${LOAN_KINDS[l.kind].label}: ${l.purpose}` : LOAN_KINDS[l.kind].label);
const pct = (s: LoanSummary) => Math.max(0, Math.min(s.loan.principal, s.repaid));

/** Admin and HR: every loan and advance, requests to decide, and the request policy. */
export function LoansView() {
  const db = useDb();
  const { canManage, employee: me } = useCurrentUser();
  const t = today();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<LoanKind | "">("");
  const [status, setStatus] = useState<ShownStatus | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<Loan | null>(null);
  const [policy, setPolicy] = useState(false);

  const byId = useMemo(() => new Map(db.employees.map((e) => [e.id, e])), [db.employees]);
  const all = useMemo(() => db.loans.map((l) => loanSummary(db, l, t)), [db, t]);
  if (!canManage) return <div className="page"><EmptyState title="Only admins and HR manage loans" body="Your own loans and advances are on the My pay page." /></div>;

  const requests = all.filter((s) => s.status === "requested").sort((a, b) => (a.loan.requested_at ?? "").localeCompare(b.loan.requested_at ?? ""));
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((s) => s.status !== "requested")
    .filter((s) => (status ? s.status === status : ["active", "paused"].includes(s.status)))
    .filter((s) => !kind || s.loan.kind === kind)
    .filter((s) => !needle || [displayName(byId.get(s.loan.employee_id)!), s.loan.reference_no ?? "", s.info.label, s.loan.purpose ?? ""].join(" ").toLowerCase().includes(needle))
    .sort((a, b) => displayName(byId.get(a.loan.employee_id)!).localeCompare(displayName(byId.get(b.loan.employee_id)!)));
  const live = all.filter((s) => s.status === "active" || s.status === "paused");
  const outstanding = live.reduce((n, s) => n + s.balance, 0);
  const filtered = Boolean(q || kind || status);
  const clear = () => { setQ(""); setKind(""); setStatus(""); };
  const openLoan = all.find((s) => s.loan.id === open);

  return (
    <div className="page page-xl">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/payroll">Payroll</Link>
        <Icon name="chevronRight" size={14} />
        <span aria-current="page">Loans</span>
      </nav>
      <header className="page-head">
        <div>
          <h1>Loans and advances</h1>
          <p className="muted">{live.length} being paid down, {peso(outstanding)} outstanding. Payroll deducts each cutoff until the balance is zero.</p>
        </div>
        <div className="head-actions">
          <Button onClick={() => setPolicy(true)}>Request policy</Button>
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add loan</Button>
        </div>
      </header>

      {requests.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Requests waiting for you</h2></div>
          <div className="req-list">
            {requests.map((s) => {
              const e = byId.get(s.loan.employee_id)!;
              const n = s.loan.requested_installments ?? 1;
              return (
                <div key={s.loan.id} className="req">
                  <div className="req-main">
                    <PersonCell person={e} sub={`${s.info.label} for ${s.loan.purpose ?? "no reason given"}`} />
                    <span className="muted small">{peso(s.loan.principal)} over {n} cutoff{n === 1 ? "" : "s"}, {peso(installmentAmount(s.loan.principal, n))} each · asked {formatDate((s.loan.requested_at ?? s.loan.created_at).slice(0, 10))}</span>
                  </div>
                  <div className="req-side">
                    {s.loan.employee_id === me.id ? <span className="muted small">Your own request: another admin or HR decides</span> : <Button size="sm" variant="primary" onClick={() => setDeciding(s.loan)}>Review</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="section">
        <div className="toolbar" role="search">
          <SearchInput value={q} onChange={setQ} label="Search loans" placeholder="Search by name, loan number or purpose" />
          <div className="filters">
            <FilterSelect<LoanKind> label="Kinds" value={kind} onChange={setKind} options={LOAN_KIND_LIST.map((k) => ({ value: k, label: LOAN_KINDS[k].label }))} />
            <FilterSelect<ShownStatus> label="Status" allLabel="Being paid" value={status} onChange={setStatus}
              options={(["active", "paused", "paid", "stopped", "rejected", "cancelled"] as const).map((v) => ({ value: v, label: STATUS_LABEL[v] }))} />
          </div>
        </div>
        <div className="table-meta">
          <span aria-live="polite">{rows.length} {rows.length === 1 ? "loan" : "loans"}</span>
          {filtered && <button type="button" className="link" onClick={clear}>Clear filters</button>}
        </div>
        {rows.length === 0 ? (
          <EmptyState title={filtered ? "No loans match these filters" : "No loans being paid"} body={filtered ? "Try another kind or status." : "Add SSS and Pag-IBIG loans from the agency billing, or a company loan or cash advance with the employee's signed authorization."}
            action={filtered ? <Button onClick={clear}>Clear filters</Button> : <Button variant="primary" onClick={() => setAdding(true)}>Add loan</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="col-md">Loan</th>
                  <th className="num r col-lg">Amount</th>
                  <th className="num r">Balance</th>
                  <th className="col-lg">Repaid</th>
                  <th className="num r col-md">Per cutoff</th>
                  <th className="col-lg">Last deduction</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const e = byId.get(s.loan.employee_id)!;
                  return (
                    <tr key={s.loan.id} className="row-link" onClick={() => setOpen(s.loan.id)}>
                      <td>
                        <button type="button" className="row-btn" onClick={(ev) => { ev.stopPropagation(); setOpen(s.loan.id); }} aria-label={`Open ${s.info.label} for ${displayName(e)}`}>
                          <PersonCell person={e} sub={e.employee_number} />
                        </button>
                      </td>
                      <td className="col-md">
                        <span className="cell-2">
                          <span>{loanTitle(s.loan)}</span>
                          <span className="muted">{s.loan.reference_no ?? (s.warning ? <span className="text-warn">No authorization on file</span> : "Company")}</span>
                        </span>
                      </td>
                      <td className="num r col-lg">{peso(s.loan.principal)}</td>
                      <td className="num r">{peso(s.balance)}</td>
                      <td className="col-lg"><span className="cell-progress"><Progress value={pct(s)} max={s.loan.principal} label={`${Math.round((pct(s) / s.loan.principal) * 100)}% repaid`} /><span className="muted small num">{Math.round((pct(s) / s.loan.principal) * 100)}%</span></span></td>
                      <td className="num r col-md">{peso(s.perCutoff)}</td>
                      <td className="col-lg num">{s.lastDeduction ? formatDate(s.lastDeduction.pay_date) : <Blank />}</td>
                      <td><LoanStatus status={s.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">SSS and Pag-IBIG loans are authorized by law and need no signed form. Company loans and cash advances are deducted only with the employee’s written authorization (Labor Code Art. 113). Monthly remittances are in <Link className="link" href="/reports?r=loan-remittances">Reports, Loan remittances</Link>.</p>
      </section>

      {openLoan && <LoanDialog summary={openLoan} employee={byId.get(openLoan.loan.employee_id)!} onClose={() => setOpen(null)} />}
      {adding && <NewLoanDialog onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); setOpen(id); }} />}
      {deciding && <DecideDialog loan={deciding} employee={byId.get(deciding.employee_id)!} onClose={() => setDeciding(null)} />}
      {policy && <PolicyDialog onClose={() => setPolicy(false)} />}
    </div>
  );
}

// ---- One loan: facts, ledger, and what HR can do with it ---------------------------------

export function LoanDialog({ summary: s, employee, onClose }: { summary: LoanSummary; employee: Employee; onClose: () => void }) {
  const { employee: me, canManage } = useCurrentUser();
  const [mode, setMode] = useState<"view" | "payment" | "edit" | "stop">("view");
  const live = s.loan.status === "active" || s.loan.status === "paused";
  const title = `${loanTitle(s.loan)}, ${displayName(employee)}`;
  if (mode === "payment") return <PaymentDialog summary={s} onClose={() => setMode("view")} byId={me.id} />;
  if (mode === "edit") return <EditLoanDialog loan={s.loan} onClose={() => setMode("view")} />;
  if (mode === "stop") return <StopDialog loan={s.loan} onClose={() => setMode("view")} />;
  const actions = canManage && (live || s.loan.status === "stopped");
  return (
    <Dialog wide title={title} description={s.info.agency ? `${s.info.agency} loan, authorized by law` : s.loan.authorization ? `Signed authorization: ${s.loan.authorization}` : undefined} onClose={onClose}
      footer={actions ? (
        <>
          {s.loan.status === "stopped" ? <Button onClick={() => updateLoan(s.loan.id, { status: "active" })}>Resume</Button> : <>
            <Button variant="ghost" onClick={() => setMode("stop")}>Stop</Button>
            <Button variant="ghost" onClick={() => updateLoan(s.loan.id, { status: s.loan.status === "paused" ? "active" : "paused" })}>{s.loan.status === "paused" ? "Resume deductions" : "Pause deductions"}</Button>
            <Button onClick={() => setMode("edit")}>Edit</Button>
            {s.balance > 0 && <Button variant="primary" onClick={() => setMode("payment")}>Record payment</Button>}
          </>}
        </>
      ) : <Button onClick={onClose}>Close</Button>}>
      {s.warning && <p className="callout-warn small">{s.warning}</p>}
      <dl className="dl dl-wide">
        <div><dt>Status</dt><dd><LoanStatus status={s.status} />{s.loan.stop_reason && <span className="muted"> · {s.loan.stop_reason}</span>}</dd></div>
        <div><dt>Amount to repay</dt><dd className="num">{peso(s.loan.principal)}</dd></div>
        <div><dt>Repaid</dt><dd className="num">{peso(s.repaid)}</dd></div>
        <div><dt>Balance</dt><dd className="num"><strong>{peso(s.balance)}</strong></dd></div>
        <div><dt>Deduction</dt><dd className="num">{peso(s.loan.monthly_amortization)} a month · {peso(s.perCutoff)} {s.loan.schedule === "split" ? "each cutoff" : `on the ${SCHEDULE_LABEL[s.loan.schedule]}`}</dd></div>
        <div><dt>Next</dt><dd className="num">{s.next ? `${peso(s.next.amount)} on ${formatDate(s.next.period.pay_date)}${s.lastDeduction && s.lastDeduction.id !== s.next.period.id ? `, last on ${formatDate(s.lastDeduction.pay_date)} (${s.remainingCutoffs} cutoffs)` : ", the last one"}` : <Blank text={s.status === "paused" ? "Paused" : "Nothing more to deduct"} />}</dd></div>
        {s.loan.reference_no && <div><dt>Loan number</dt><dd>{s.loan.reference_no}</dd></div>}
        <div><dt>First deduction</dt><dd className="num">Period ending on or after {formatDate(s.loan.first_deduction_on)}</dd></div>
      </dl>
      <h3 className="sub-h">Ledger</h3>
      {s.ledger.length === 0 ? <p className="muted">Nothing repaid yet. Payroll deductions show here once a payroll period is finalized.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>What</th><th className="num r">Amount</th></tr></thead>
            <tbody>
              {s.ledger.map((l, i) => (
                <tr key={i}>
                  <td className="num nowrap">{formatDate(l.date)}</td>
                  <td>{l.kind === "payroll" || l.kind === "opening" ? l.label : <span className="cell-2"><span>{l.kind === "paid_directly" ? "Paid directly" : "Adjustment"}</span><span className="muted">{l.label}</span></span>}</td>
                  <td className="num r">{peso(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

function PaymentDialog({ summary: s, byId, onClose }: { summary: LoanSummary; byId: string; onClose: () => void }) {
  const [method, setMethod] = useState<LoanPaymentMethod>("paid_directly");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = () => {
    const e = recordLoanPayment(s.loan.id, { amount: money(amount), paid_on: date, method, note: note || null }, byId);
    if (Object.keys(e).length) return setErrors(e);
    onClose();
  };
  return (
    <Dialog title="Record a payment" description={`Balance ${peso(s.balance)}. For money paid outside payroll, or a correction after reconciling with the agency.`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Record payment</Button></>}>
      <div className="form-grid">
        {errors.body && <p className="callout-warn span-2">{errors.body}</p>}
        <Choice legend="Kind" value={method} onChange={setMethod} options={[{ value: "paid_directly", label: "Paid directly" }, { value: "adjustment", label: "Adjustment" }]}
          hint={method === "adjustment" ? "Use a negative amount to add back to the balance." : "The employee paid the agency or the cashier."} />
        <Field label="Amount" error={errors.amount}>{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} />}</Field>
        <Field label="Paid on" error={errors.paid_on}>{(id, d) => <input id={id} aria-describedby={d} type="date" max={today()} value={date} onChange={(ev) => setDate(ev.target.value)} />}</Field>
        <div className="span-2"><Field label="Note" hint="Receipt or official receipt number, or what the adjustment is for.">{(id, d) => <input id={id} aria-describedby={d} value={note} onChange={(ev) => setNote(ev.target.value)} />}</Field></div>
      </div>
    </Dialog>
  );
}

function EditLoanDialog({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const info = LOAN_KINDS[loan.kind];
  const [monthly, setMonthly] = useState(String(loan.monthly_amortization));
  const [schedule, setSchedule] = useState<ContributionTiming>(loan.schedule);
  const [ref, setRef] = useState(loan.reference_no ?? "");
  const [auth, setAuth] = useState(loan.authorization ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = () => {
    const e = updateLoan(loan.id, { monthly_amortization: money(monthly), schedule, reference_no: ref, ...(info.needsAuthorization ? { authorization: auth } : {}) });
    if (Object.keys(e).length) return setErrors(e);
    onClose();
  };
  return (
    <Dialog title="Edit loan" description="Changes apply from the open payroll period. Issued payslips don't change." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Monthly amortization" error={errors.monthly_amortization}>{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={monthly} onChange={(ev) => setMonthly(ev.target.value)} />}</Field>
        <Field label={info.agency ? `${info.agency} loan number` : "Reference"}>{(id, d) => <input id={id} aria-describedby={d} value={ref} onChange={(ev) => setRef(ev.target.value)} />}</Field>
        <Choice legend="Deduct on" value={schedule} onChange={setSchedule} options={(Object.keys(SCHEDULE_LABEL) as ContributionTiming[]).map((v) => ({ value: v, label: SCHEDULE_LABEL[v] }))} />
        {info.needsAuthorization && <div className="span-2"><Field label="Signed authorization" hint="Where the signed form is kept. Without it payroll can't deduct (Art. 113).">{(id, d) => <input id={id} aria-describedby={d} value={auth} onChange={(ev) => setAuth(ev.target.value)} />}</Field></div>}
      </div>
    </Dialog>
  );
}

function StopDialog({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const stop = () => {
    const e = updateLoan(loan.id, { status: "stopped", stop_reason: reason });
    if (Object.keys(e).length) return setError(e.stop_reason ?? e.body ?? "");
    onClose();
  };
  return (
    <Dialog title="Stop this loan" description="Payroll stops deducting. The ledger and balance stay as they are." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={stop}>Stop loan</Button></>}>
      <Field label="Reason" hint="For example: settled in final pay, written off, or transferred to the new employer's payroll." error={error || undefined}>
        {(id, d) => <input id={id} aria-describedby={d} value={reason} onChange={(ev) => { setReason(ev.target.value); setError(""); }} />}
      </Field>
    </Dialog>
  );
}

// ---- New loan, entered by HR -----------------------------------------------------------

function NewLoanDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const people = db.employees.filter((e) => e.status !== "offboarded" && monthlyBasic(db, e.id)).sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const [who, setWho] = useState("");
  const [kind, setKind] = useState<LoanKind>("sss_salary");
  const [principal, setPrincipal] = useState("");
  const [before, setBefore] = useState("");
  const [monthly, setMonthly] = useState("");
  const [schedule, setSchedule] = useState<ContributionTiming>("split");
  const [first, setFirst] = useState(today());
  const [ref, setRef] = useState("");
  const [purpose, setPurpose] = useState("");
  const [auth, setAuth] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const info = LOAN_KINDS[kind];
  const m = money(monthly);
  const save = () => {
    const r = saveLoan({
      employee_id: who, kind, principal: money(principal), paid_before: before ? money(before) : 0, monthly_amortization: m, schedule, first_deduction_on: first,
      reference_no: ref || null, purpose: info.agency ? null : purpose || null, authorization: info.needsAuthorization ? auth || null : null,
    }, me.id);
    if (!r.loan) return setErrors(r.errors);
    onSaved(r.loan.id);
  };
  return (
    <Dialog wide title="Add a loan" description={info.agency ? `Copy the figures from the ${info.agency} loan billing. Halden deducts them and lists them for remittance.` : "Interest-free unless the signed authorization says otherwise. Put any interest in the amount to repay."} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Add loan</Button></>}>
      <div className="form-grid">
        <Field label="Employee" error={errors.employee_id}>
          {(id, d) => <select id={id} aria-describedby={d} value={who} onChange={(ev) => setWho(ev.target.value)}><option value="">Choose a person</option>{people.map((e) => <option key={e.id} value={e.id}>{displayName(e)} · {e.employee_number}</option>)}</select>}
        </Field>
        <Field label="Kind" error={errors.kind}>
          {(id, d) => <select id={id} aria-describedby={d} value={kind} onChange={(ev) => setKind(ev.target.value as LoanKind)}>{LOAN_KIND_LIST.map((k) => <option key={k} value={k}>{LOAN_KINDS[k].label}</option>)}</select>}
        </Field>
        <Field label="Amount to repay" hint={info.agency ? "The total in the amortization schedule, interest included." : "The amount released."} error={errors.principal}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={principal} onChange={(ev) => setPrincipal(ev.target.value)} />}
        </Field>
        <Field label="Repaid before Halden" hint="Leave empty for a new loan." error={errors.paid_before}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={before} onChange={(ev) => setBefore(ev.target.value)} />}
        </Field>
        <Field label="Monthly amortization" hint={Number.isFinite(m) && m > 0 ? `${peso(perCutoff({ monthly_amortization: m, schedule }))} per deduction` : undefined} error={errors.monthly_amortization}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={monthly} onChange={(ev) => setMonthly(ev.target.value)} />}
        </Field>
        <Field label="First deduction" hint={info.agency === "SSS" ? "SSS amortizations start the second month after the loan is granted." : "The first payroll period ending on or after this date."} error={errors.first_deduction_on}>
          {(id, d) => <input id={id} aria-describedby={d} type="date" value={first} onChange={(ev) => setFirst(ev.target.value)} />}
        </Field>
        <Choice legend="Deduct on" value={schedule} onChange={setSchedule} options={(Object.keys(SCHEDULE_LABEL) as ContributionTiming[]).map((v) => ({ value: v, label: SCHEDULE_LABEL[v] }))} />
        {info.agency ? (
          <Field label={`${info.agency} loan number`} error={errors.reference_no}>{(id, d) => <input id={id} aria-describedby={d} value={ref} onChange={(ev) => setRef(ev.target.value)} />}</Field>
        ) : (
          <>
            <Field label="Purpose">{(id, d) => <input id={id} aria-describedby={d} value={purpose} onChange={(ev) => setPurpose(ev.target.value)} />}</Field>
            <Field label="Voucher or reference" hint="Optional.">{(id, d) => <input id={id} aria-describedby={d} value={ref} onChange={(ev) => setRef(ev.target.value)} />}</Field>
            <div className="span-2">
              <Field label="Signed authorization" hint={auth ? "Payroll deducts it from the first deduction date." : "Where the employee's signed salary deduction form is kept. Without it the loan is saved but not deducted (Art. 113)."}>
                {(id, d) => <input id={id} aria-describedby={d} value={auth} onChange={(ev) => setAuth(ev.target.value)} />}
              </Field>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---- Deciding a request ------------------------------------------------------------------

function DecideDialog({ loan, employee, onClose }: { loan: Loan; employee: Employee; onClose: () => void }) {
  const { employee: me } = useCurrentUser();
  const db = useDb();
  const n = loan.requested_installments ?? 1;
  const [first, setFirst] = useState(today());
  const [schedule, setSchedule] = useState<ContributionTiming>("split");
  const [auth, setAuth] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const per = installmentAmount(loan.principal, n);
  const basic = monthlyBasic(db, employee.id) ?? 0;
  const others = db.loans.filter((l) => l.employee_id === employee.id && l.id !== loan.id && (l.status === "active" || l.status === "paused")).map((l) => loanSummary(db, l, today())).filter((s) => s.balance > 0);
  const decide = (approve: boolean) => {
    const e = decideLoan(loan.id, me.id, { approve, first_deduction_on: first, schedule, authorization: auth, note });
    if (Object.keys(e).length) return setErrors(e);
    onClose();
  };
  return (
    <Dialog wide title={`${LOAN_KINDS[loan.kind].label} for ${displayName(employee)}`} description={`${peso(loan.principal)} for ${loan.purpose ?? "no reason given"}, repaid over ${n} cutoff${n === 1 ? "" : "s"}.`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={() => decide(false)}>Reject</Button><Button variant="primary" onClick={() => decide(true)}>Approve</Button></>}>
      <div className="stack-lg">
      <dl className="dl dl-wide">
        <div><dt>Monthly basic pay</dt><dd className="num">{peso(basic)}</dd></div>
        <div><dt>Per cutoff</dt><dd className="num">{peso(per)}{schedule !== "split" ? ` once a month, ${peso(per)} on the ${SCHEDULE_LABEL[schedule]}` : ""}</dd></div>
        <div><dt>Other loans</dt><dd>{others.length ? others.map((s) => `${s.info.label} ${peso(s.perCutoff)} a cutoff, ${peso(s.balance)} left`).join("; ") : "None"}</dd></div>
      </dl>
      <div className="form-grid">
        {errors.body && <p className="callout-warn span-2">{errors.body}</p>}
        <Field label="First deduction" hint="The first payroll period ending on or after this date." error={errors.first_deduction_on}>
          {(id, d) => <input id={id} aria-describedby={d} type="date" value={first} onChange={(ev) => setFirst(ev.target.value)} />}
        </Field>
        <Field label="Signed authorization" hint="Where the employee's signed salary deduction form is kept." error={errors.authorization}>
          {(id, d) => <input id={id} aria-describedby={d} value={auth} onChange={(ev) => setAuth(ev.target.value)} />}
        </Field>
        <Choice legend="Deduct on" value={schedule} onChange={setSchedule} options={(Object.keys(SCHEDULE_LABEL) as ContributionTiming[]).map((v) => ({ value: v, label: SCHEDULE_LABEL[v] }))} />
        <div className="span-2"><Field label="Note to the employee" hint="Optional. Shown with the decision.">{(id, d) => <input id={id} aria-describedby={d} value={note} onChange={(ev) => setNote(ev.target.value)} />}</Field></div>
      </div>
      </div>
    </Dialog>
  );
}

// ---- Policy ----------------------------------------------------------------------------

function PolicyDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const s = db.loan_settings;
  const [allow, setAllow] = useState(s.allow_requests);
  const [share, setShare] = useState(String(Math.round(s.cash_advance_max_share * 100)));
  const [months, setMonths] = useState(String(s.company_loan_max_months));
  const [max, setMax] = useState(String(s.max_installments));
  const [one, setOne] = useState(s.one_open_at_a_time);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = () => {
    const e: Record<string, string> = {};
    const sh = Number(share), mo = Number(months), mx = Number(max);
    if (!Number.isFinite(sh) || sh < 5 || sh > 100) e.share = "Use 5 to 100 percent.";
    if (!Number.isFinite(mo) || mo < 0.5 || mo > 12) e.months = "Use 0.5 to 12 months.";
    if (!Number.isInteger(mx) || mx < 1 || mx > 48) e.max = "Use 1 to 48 cutoffs.";
    if (Object.keys(e).length) return setErrors(e);
    updateLoanSettings({ allow_requests: allow, cash_advance_max_share: sh / 100, company_loan_max_months: mo, max_installments: mx, one_open_at_a_time: one });
    onClose();
  };
  return (
    <Dialog title="Request policy" description="What employees can ask for from My pay. HR can still enter any loan directly." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Toggle label="Employees can ask for cash advances and company loans" checked={allow} onChange={setAllow} />
        <Field label="Largest cash advance, % of monthly basic pay" error={errors.share}>{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={share} onChange={(ev) => setShare(ev.target.value)} disabled={!allow} />}</Field>
        <Field label="Largest company loan, months of basic pay" error={errors.months}>{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={months} onChange={(ev) => setMonths(ev.target.value)} disabled={!allow} />}</Field>
        <Field label="Most cutoffs to repay" error={errors.max}>{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={max} onChange={(ev) => setMax(ev.target.value)} disabled={!allow} />}</Field>
        <Toggle label="One open loan, advance or request at a time" checked={one} onChange={setOne} disabled={!allow} />
      </div>
    </Dialog>
  );
}
