"use client";

import { useState } from "react";
import { adjustLeave, regularize, separateEmployee, today, updateEmployee, useDb } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { PROBATION_MAX_DAYS, employmentAlerts, legalStatus, monthsOfService, probationEndFor, separationLabel, statusLabel } from "@/lib/employment";
import { SEPARATION_RULES, finalPay, type FinalPay } from "@/lib/finalpay";
import { peso } from "@/lib/payroll";
import { leaveTypesFor } from "@/lib/leave";
import type { Employee, EmploymentStatusPH, SeparationReason } from "@/lib/types";
import { Button, Dialog, Field, Icon } from "@/components/ui";
import { BalanceTable, balancesFor } from "@/features/leave/MyLeaveView";

/** Philippine employment terms: status, probation, contract end, and the separation flow with a final pay statement. */
export function EmploymentTerms({ employee: e }: { employee: Employee }) {
  const db = useDb();
  const [editing, setEditing] = useState(false);
  const [separating, setSeparating] = useState(false);
  if (!e.employment_status_ph) return null;
  const legal = legalStatus(e, today());
  const alerts = employmentAlerts(db, today()).filter((a) => a.employee.id === e.id);
  const probEnd = e.probation_end_date ?? probationEndFor(e.start_date);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Employment terms</h2>
        <div className="head-actions">
          <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>
          {e.employment_status_ph === "probationary" && legal.status === "probationary" && e.start_date <= today() && (
            <Button size="sm" onClick={() => regularize(e.id, today())}>Regularize</Button>
          )}
          {!e.end_date && <Button size="sm" onClick={() => setSeparating(true)}>Record separation</Button>}
        </div>
      </div>
      <dl className="terms">
        <div><dt>Status on file</dt><dd>{statusLabel[e.employment_status_ph]}</dd></div>
        {legal.status && legal.status !== e.employment_status_ph && <div><dt>Status in law</dt><dd className="text-danger">{statusLabel[legal.status]}</dd></div>}
        {e.employment_status_ph === "probationary" && <>
          <div><dt>Probation ends</dt><dd className="num">{formatDate(probEnd)}</dd></div>
          <div><dt>Standards given in writing</dt><dd>{e.standards_given_on ? formatDate(e.standards_given_on) : <span className="text-warn">Not on file</span>}</dd></div>
        </>}
        {e.regularized_on && <div><dt>Regular since</dt><dd className="num">{formatDate(e.regularized_on)}</dd></div>}
        {["project", "seasonal", "fixed_term"].includes(e.employment_status_ph) && <div><dt>Contract ends</dt><dd>{e.contract_end_date ? formatDate(e.contract_end_date) : <span className="text-danger">No end date</span>}</dd></div>}
        <div><dt>Service</dt><dd>{Math.floor(monthsOfService(e.start_date, today()) / 12)} years, {monthsOfService(e.start_date, today()) % 12} months</dd></div>
        {e.birth_date && <div><dt>Birth date</dt><dd className="num">{formatDate(e.birth_date)}</dd></div>}
        {e.end_date && <div><dt>Last day</dt><dd>{formatDate(e.end_date)}{e.separation_reason && <span className="cell-sub">{separationLabel[e.separation_reason]}</span>}</dd></div>}
      </dl>
      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((a, i) => <p key={i} className={`check check-${a.severity}`}><Icon name="alert" size={18} /> <span>{a.message}</span></p>)}
        </div>
      )}
      {e.end_date && e.separation_reason && <FinalPayStatement fp={finalPay(db, e, e.end_date, e.separation_reason, new Date().toISOString())} />}
      {editing && <TermsDialog employee={e} onClose={() => setEditing(false)} />}
      {separating && <SeparateDialog employee={e} onClose={() => setSeparating(false)} />}
    </section>
  );
}

function TermsDialog({ employee: e, onClose }: { employee: Employee; onClose: () => void }) {
  const [f, setF] = useState({
    status: e.employment_status_ph ?? "probationary", probation: e.probation_end_date ?? probationEndFor(e.start_date), standards: e.standards_given_on ?? "",
    contract: e.contract_end_date ?? "", birth: e.birth_date ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => { setF((p) => ({ ...p, [k]: v })); setErrors({}); };
  const contractual = ["project", "seasonal", "fixed_term"].includes(f.status);

  const save = () => {
    const err: Record<string, string> = {};
    if (f.status === "probationary" && f.probation > probationEndFor(e.start_date)) err.probation = `Probation can’t run past ${formatDate(probationEndFor(e.start_date))}, ${PROBATION_MAX_DAYS} days from the start (Art. 296).`;
    if (contractual && !f.contract) err.contract = "Set when the project, season or term ends. Without it, the law can treat them as regular.";
    setErrors(err);
    if (Object.keys(err).length) return;
    updateEmployee(e.id, {
      employment_status_ph: f.status as EmploymentStatusPH,
      probation_end_date: f.status === "probationary" ? f.probation : e.probation_end_date,
      standards_given_on: f.standards || null,
      contract_end_date: contractual ? f.contract : null,
      birth_date: f.birth || null,
      regularized_on: f.status === "regular" ? e.regularized_on ?? today() : null,
    });
    onClose();
  };

  return (
    <Dialog title="Employment terms" description="Labor Code Art. 295–296. What's on file must match how the person actually works." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <div className="span-2">
          <Field label="Status" hint={f.status === "casual" ? "Casual staff become regular for that activity after a year of service." : f.status === "fixed_term" ? "Only valid when the term was knowingly agreed and not meant to get around regularization (Brent School v. Zamora)." : f.status === "project" ? "The project and its end must be made known at hiring." : undefined}>
            {(id, d) => (
              <select id={id} aria-describedby={d} value={f.status} onChange={(ev) => set("status", ev.target.value)}>
                {(Object.keys(statusLabel) as EmploymentStatusPH[]).map((k) => <option key={k} value={k}>{statusLabel[k]}</option>)}
              </select>
            )}
          </Field>
        </div>
        {f.status === "probationary" && <>
          <Field label="Probation ends" error={errors.probation}>{(id, d) => <input id={id} type="date" aria-describedby={d} value={f.probation} max={probationEndFor(e.start_date)} onChange={(ev) => set("probation", ev.target.value)} />}</Field>
          <Field label="Standards given in writing on" hint="On or before the first day.">{(id, d) => <input id={id} type="date" aria-describedby={d} value={f.standards} onChange={(ev) => set("standards", ev.target.value)} />}</Field>
        </>}
        {contractual && <div className="span-2"><Field label="Ends on" error={errors.contract}>{(id, d) => <input id={id} type="date" aria-describedby={d} value={f.contract} onChange={(ev) => set("contract", ev.target.value)} />}</Field></div>}
        <div className="span-2"><Field label="Birth date" hint="Used for retirement pay eligibility (RA 7641).">{(id, d) => <input id={id} type="date" aria-describedby={d} value={f.birth} onChange={(ev) => set("birth", ev.target.value)} />}</Field></div>
      </div>
    </Dialog>
  );
}

function SeparateDialog({ employee: e, onClose }: { employee: Employee; onClose: () => void }) {
  const db = useDb();
  const [lastDay, setLastDay] = useState(e.contract_end_date ?? today());
  const [reason, setReason] = useState<SeparationReason>(e.contract_end_date ? "end_of_contract" : "resignation");
  const [notice, setNotice] = useState(today());
  const fp = lastDay >= e.start_date ? finalPay(db, e, lastDay, reason, new Date().toISOString(), notice || null) : null;
  const rule = SEPARATION_RULES[reason];

  return (
    <Dialog wide title={`Record ${e.preferred_name ?? e.first_name}’s separation`} description="The final pay statement updates as you change the details. Nothing is saved until you confirm." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!fp} onClick={() => { separateEmployee(e.id, lastDay, reason, notice || null); onClose(); }}>Record separation</Button></>}>
      <div className="form-grid">
        <div className="span-2">
          <Field label="Reason" hint={rule.basis}>
            {(id, d) => (
              <select id={id} aria-describedby={d} value={reason} onChange={(ev) => setReason(ev.target.value as SeparationReason)}>
                {(Object.keys(separationLabel) as SeparationReason[]).map((k) => <option key={k} value={k}>{separationLabel[k]}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="Last day">{(id) => <input id={id} type="date" value={lastDay} min={e.start_date} onChange={(ev) => setLastDay(ev.target.value)} />}</Field>
        <Field label={reason === "resignation" ? "Resignation letter dated" : "Written notice served on"} hint={rule.notice}>{(id, d) => <input id={id} type="date" aria-describedby={d} value={notice} onChange={(ev) => setNotice(ev.target.value)} />}</Field>
      </div>
      {fp && <FinalPayStatement fp={fp} />}
    </Dialog>
  );
}

export function FinalPayStatement({ fp }: { fp: FinalPay }) {
  return (
    <div className="final-pay">
      <h3 className="sub-h">Final pay statement</h3>
      <table className="table fp-table">
        <caption className="sr-only">Final pay</caption>
        <tbody>
          <tr><td>Last cutoff, net{fp.lastSlip && <span className="cell-sub">{formatDate(fp.lastSlip.period.start_date)} to {formatDate(fp.lastDay)}, after contributions and loan installments</span>}</td><td className="num r">{peso(fp.lastSlip?.net ?? 0)}</td></tr>
          {fp.lines.map((l) => (
            <tr key={l.key}><td>{l.label}<span className="cell-sub">{l.detail}{l.taxable > 0 ? ` · ${peso(l.taxable)} taxable` : " · tax-free"}</span></td><td className="num r">{peso(l.amount)}</td></tr>
          ))}
          {fp.deductions.map((l) => <tr key={l.key}><td>{l.label}<span className="cell-sub">{l.detail} · signed authorization on file</span></td><td className="num r">−{peso(l.amount)}</td></tr>)}
          <tr><td>{fp.taxAdjustment < 0 ? "Tax refund" : "Tax still due"}<span className="cell-sub">The year annualized up to the last day</span></td><td className="num r">{fp.taxAdjustment < 0 ? peso(-fp.taxAdjustment) : `−${peso(fp.taxAdjustment)}`}</td></tr>
          <tr className="fp-total"><td>Final pay</td><td className="num r">{peso(fp.total)}</td></tr>
        </tbody>
      </table>
      {fp.statutoryLoans.length > 0 && (
        <p className="check check-warn small"><Icon name="alert" size={18} /> <span>{fp.statutoryLoans.map((l) => `${l.label} ${peso(l.amount)}`).join("; ")}. Report the separation to the agency; it collects the balance or offsets it against benefits.</span></p>
      )}
      <ul className="checks-list small">
        {fp.checks.map((c, i) => <li key={i} className={c.ok ? "ok" : "bad"}><Icon name={c.ok ? "check" : "alert"} size={16} /><span>{c.text}</span></li>)}
      </ul>
    </div>
  );
}

/** HR's view of one person's leave: balances, and a way to correct them. */
export function LeaveTab({ employee: e, canAdjust }: { employee: Employee; canAdjust: boolean }) {
  const db = useDb();
  const year = Number(today().slice(0, 4));
  const { yearly } = balancesFor(db, e, year, today());
  const [adjusting, setAdjusting] = useState(false);
  return (
    <section className="panel" role="tabpanel" id="panel-leave" aria-labelledby="tab-leave">
      <div className="panel-head">
        <h2>Leave in {year}</h2>
        {canAdjust && <Button size="sm" variant="ghost" onClick={() => setAdjusting(true)}>Adjust a balance</Button>}
      </div>
      <BalanceTable balances={yearly} caption={`Leave balances for ${year}`} />
      {adjusting && <AdjustDialog employee={e} year={year} onClose={() => setAdjusting(false)} />}
    </section>
  );
}

function AdjustDialog({ employee: e, year, onClose }: { employee: Employee; year: number; onClose: () => void }) {
  const db = useDb();
  const types = leaveTypesFor(db).filter((t) => t.accrual !== "per_event");
  const [type, setType] = useState(types[0]?.id ?? "");
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = () => {
    const n = Number(days);
    if (!Number.isFinite(n) || n === 0 || Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) return setError("Enter days in halves, like 2 or −0.5.");
    if (note.trim().length < 3) return setError("Say why, for the audit trail.");
    adjustLeave({ employee_id: e.id, leave_type_id: type, year, days: n, note: note.trim() });
    onClose();
  };
  return (
    <Dialog title="Adjust a leave balance" description="For go-live balances, awards, or corrections. Every change is kept." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Leave">{(id) => <select id={id} value={type} onChange={(ev) => setType(ev.target.value)}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}</Field>
        <Field label="Days to add (− to remove)" error={error || undefined}>{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={days} onChange={(ev) => { setDays(ev.target.value); setError(""); }} />}</Field>
        <div className="span-2"><Field label="Reason">{(id) => <input id={id} value={note} onChange={(ev) => { setNote(ev.target.value); setError(""); }} />}</Field></div>
      </div>
    </Dialog>
  );
}
