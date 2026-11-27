"use client";

import { useState, type FormEvent } from "react";
import { cancelLeave, fileLeave, isPeriodLocked, today, useCurrentUser, useDb } from "@/lib/store";
import { displayName, formatDate } from "@/lib/format";
import { SIL_ID, leaveBalance, leaveTypesFor, requestDays, validateLeave, type LeaveBalance } from "@/lib/leave";
import type { Database, Employee, LeaveType } from "@/lib/types";
import { Button, Dialog, EmptyState, Field, Icon, Blank } from "@/components/ui";
import { RequestStatusBadge } from "@/features/requests/MyRequests";

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Balances split into what accrues each year and the leaves granted per event (maternity, bereavement and the like). */
export function balancesFor(db: Database, e: Employee, year: number, asOf: string) {
  const types = leaveTypesFor(db);
  const all = types.map((t) => leaveBalance(db, e, t, year, asOf));
  // Statutory leave for specific situations (solo parents, VAWC) isn't a balance most people have; list it with life events.
  const situational = (b: LeaveBalance) => b.type.accrual === "per_event" || (b.type.statutory && b.type.id !== SIL_ID);
  return { yearly: all.filter((b) => !situational(b)), perEvent: all.filter(situational) };
}

export function BalanceTable({ balances, caption }: { balances: LeaveBalance[]; caption: string }) {
  return (
    <div className="table-wrap">
      <table className="table leave-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Leave</th>
            <th scope="col" className="num r col-md">Earned</th>
            <th scope="col" className="num r col-md">Carried over</th>
            <th scope="col" className="num r">Used</th>
            <th scope="col" className="num r col-md">Pending</th>
            <th scope="col" className="num r">Available</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => {
            const notYet = b.eligibleFrom > today();
            return (
              <tr key={b.type.id}>
                <td>
                  <span className="cell-2">
                    <span>{b.type.name}{b.type.statutory && <span className="muted"> · by law</span>}{!b.type.paid && <span className="muted"> · unpaid</span>}</span>
                    <span className="muted">
                      {notYet ? `Available from ${formatDate(b.eligibleFrom)}` : `${b.type.days} a year${b.type.accrual === "monthly" ? `, ${+(b.type.days / 12).toFixed(2)} a month` : ""}`}
                      {b.type.convertible ? " · unused days paid in cash" : ""}
                    </span>
                  </span>
                </td>
                <td className="num r col-md">{b.granted}{b.adjusted ? <span className="muted small"> {b.adjusted > 0 ? "+" : "−"}{Math.abs(b.adjusted)}</span> : null}</td>
                <td className="num r col-md">{b.carried || <Blank />}</td>
                <td className="num r">{b.used || <Blank />}</td>
                <td className="num r col-md">{b.pending || <Blank />}</td>
                <td className="num r"><strong>{b.available}</strong></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MyLeaveView() {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const [filing, setFiling] = useState<LeaveType | null | "pick">(null);
  const [filed, setFiled] = useState("");
  const year = Number(today().slice(0, 4));
  const onPhPayroll = db.compensation.some((c) => c.employee_id === me.id && c.on_ph_payroll);

  if (!onPhPayroll) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>My leave</h1></div></header>
        <EmptyState title="Leave for your office isn’t in Halden yet" body="Leave here follows Philippine law and Halden’s Philippine policies. Ask HR how leave works where you are." />
      </div>
    );
  }

  const { yearly, perEvent } = balancesFor(db, me, year, today());
  const mine = db.leave_requests.filter((r) => r.employee_id === me.id).sort((a, b) => b.filed_at.localeCompare(a.filed_at));
  const name = (id: string | null) => { const e = db.employees.find((x) => x.id === id); return e ? displayName(e) : ""; };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>My leave</h1>
          <p className="muted">Balances for {year}. Philippine law sets the minimum; Halden’s policies add to it.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setFiling("pick")}>Request leave</Button>
      </header>

      {filed && (
        <div className="toast" role="status">
          <Icon name="check" size={18} /><span>{filed}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setFiled("")}><Icon name="x" size={16} /></button>
        </div>
      )}

      <section className="section">
        <h2>Balances</h2>
        <BalanceTable balances={yearly} caption={`Leave balances for ${year}`} />
      </section>

      <section className="section">
        <h2>Leave for specific situations</h2>
        <p className="muted">For life events and for people the law protects. HR checks who it applies to, and the documents, when approving.</p>
        <ul className="event-leaves">
          {perEvent.map((b) => (
            <li key={b.type.id} className="event-leave">
              <div>
                <strong>{b.type.name}</strong> <span className="muted">· {days(b.type.days)}{b.type.accrual === "per_event" ? (b.type.calendar_days ? " in a row, calendar days" : " each time") : " a year"}{b.type.paid ? "" : ", unpaid"}{b.type.accrual !== "per_event" && b.used ? `, ${b.used} used` : ""}</span>
                {b.type.who && <p className="muted small">{b.type.who}</p>}
              </div>
              <Button size="sm" onClick={() => setFiling(b.type)}>Request</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>My requests</h2>
        {mine.length === 0 ? <p className="muted">No leave requests yet.</p> : (
          <ul className="req-list">
            {mine.map((r) => {
              const t = db.leave_types.find((x) => x.id === r.leave_type_id);
              const n = requestDays(db, r);
              return (
                <li key={r.id} className="req">
                  <div className="req-main">
                    <span className="req-title"><strong>{t?.name ?? "Leave"} · {r.half_day ? "half day" : days(n)}</strong></span>
                    <span className="muted">{r.start_date === r.end_date ? formatDate(r.start_date) : `${formatDate(r.start_date)} to ${formatDate(r.end_date)}`} · {r.reason}</span>
                    {r.status !== "pending" && r.decided_by && (
                      <span className={r.status === "rejected" ? "text-danger" : "muted"}>{r.status === "approved" ? "Approved" : "Rejected"} by {name(r.decided_by)}{r.decision_note ? `: “${r.decision_note}”` : ""}</span>
                    )}
                  </div>
                  <div className="req-side">
                    <RequestStatusBadge status={r.status} />
                    {r.status === "pending" && <Button size="sm" variant="ghost" onClick={() => cancelLeave(r.id)}>Withdraw</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {filing && (
        <LeaveDialog
          employee={me}
          initialType={filing === "pick" ? null : filing}
          onClose={() => setFiling(null)}
          onDone={(msg) => { setFiling(null); setFiled(msg); }}
        />
      )}
    </div>
  );
}

export function LeaveDialog({ employee, initialType, onClose, onDone }: { employee: Employee; initialType: LeaveType | null; onClose: () => void; onDone: (msg: string) => void }) {
  const db = useDb();
  const types = leaveTypesFor(db);
  const first = initialType ?? types.find((t) => t.counts_as_sil) ?? types[0];
  const [f, setF] = useState({ type: first.id, start: today(), end: today(), half: false, reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((p) => ({ ...p, [k]: v, ...(k === "start" && p.end < (v as string) ? { end: v as string } : {}) })); setErrors({}); };
  const t = types.find((x) => x.id === f.type)!;
  const n = f.half ? 0.5 : requestDays(db, { start_date: f.start, end_date: f.end, half_day: false, leave_type_id: t.id, employee_id: employee.id });
  const year = Number(f.start.slice(0, 4));
  const b = leaveBalance(db, employee, t, year, f.start > today() ? f.start : today()); // credits earned by the first day

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e = validateLeave(db, employee, t, f.start, f.end, f.half, today());
    if (isPeriodLocked(db, f.start)) e.start = "Payroll for this date is finalized. Ask HR to handle it as an adjustment.";
    if (f.reason.trim().length < 3) e.reason = "Add a short note for your approver.";
    setErrors(e);
    if (Object.keys(e).length) return;
    fileLeave({ employee_id: employee.id, leave_type_id: t.id, start_date: f.start, end_date: f.end, half_day: f.half, reason: f.reason.trim() });
    onDone(`${t.name} requested for ${f.half ? "half a day" : days(n)}. Your manager and HR can approve it.`);
  };

  return (
    <Dialog
      title="Request leave"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="leave-form">Submit for approval</Button></>}
    >
      <form id="leave-form" className="form-grid" onSubmit={submit} noValidate>
        <div className="span-2">
          <Field label="Type of leave" error={errors.type} hint={errors.type ? undefined : t.accrual === "per_event" ? `Up to ${days(t.days)} each time${t.legal_basis ? ` (${t.legal_basis})` : ""}.` : `${b.available - b.pending} days available on ${formatDate(f.start > today() ? f.start : today())}${b.pending ? `, after ${b.pending} pending` : ""}${t.accrual === "monthly" ? `. You earn ${+(t.days / 12).toFixed(2)} more each month` : ""}.`}>
            {(id, d) => (
              <select id={id} aria-describedby={d} value={f.type} onChange={(e) => set("type", e.target.value)}>
                {types.map((x) => <option key={x.id} value={x.id}>{x.name}{x.paid ? "" : " (unpaid)"}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="First day" error={errors.start}>
          {(id, d) => <input id={id} type="date" aria-describedby={d} value={f.start} onChange={(e) => set("start", e.target.value)} />}
        </Field>
        <Field label="Last day" error={errors.end} hint={errors.end ? undefined : f.half ? "Half a day" : `${days(n)}${t.calendar_days ? ", calendar days" : ", not counting rest days and holidays"}`}>
          {(id, d) => <input id={id} type="date" aria-describedby={d} value={f.end} min={f.start} disabled={f.half} onChange={(e) => set("end", e.target.value)} />}
        </Field>
        {t.accrual !== "per_event" && (
          <label className="toggle-row span-2 toggle-inline">
            <input type="checkbox" checked={f.half} onChange={(e) => { set("half", e.target.checked); if (e.target.checked) setF((p) => ({ ...p, end: p.start, half: true })); }} />
            <span>Half day</span>
          </label>
        )}
        <div className="span-2">
          <Field label="Note for your approver" error={errors.reason} hint={t.requires_document ? `You’ll need: ${t.requires_document}.` : undefined}>
            {(id, d) => <textarea id={id} rows={2} aria-describedby={d} value={f.reason} onChange={(e) => set("reason", e.target.value)} />}
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
