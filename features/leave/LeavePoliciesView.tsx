"use client";

import { useState } from "react";
import { saveLeaveType, useCurrentUser, useDb } from "@/lib/store";
import { SIL_ID, leaveTypesFor } from "@/lib/leave";
import type { LeaveAccrual, LeaveType } from "@/lib/types";
import { Button, Dialog, EmptyState, Field } from "@/components/ui";
import { Choice, Toggle } from "@/features/payroll/SettingsDialog";

const accrualLabel: Record<LeaveAccrual, string> = { annual: "Yearly, all at once", monthly: "Earned each month", per_event: "Each time it applies" };

export function LeavePoliciesView() {
  const db = useDb();
  const { canManage } = useCurrentUser();
  const [editing, setEditing] = useState<LeaveType | "new" | null>(null);
  if (!canManage) return <div className="page"><EmptyState title="Only admins and HR can change leave policies" body="Your balances are on the My leave page." /></div>;

  const visible = new Set(leaveTypesFor(db).map((t) => t.id));
  const silReplaced = !visible.has(SIL_ID);
  const replacing = db.leave_types.find((t) => t.counts_as_sil && !t.statutory && t.active);

  const table = (rows: LeaveType[]) => (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Leave</th>
            <th scope="col" className="num r">Days</th>
            <th scope="col" className="col-md">Earned</th>
            <th scope="col" className="col-lg">Rules</th>
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className={t.active && visible.has(t.id) ? "" : "row-muted"}>
              <td>
                <span className="cell-2">
                  <span>{t.name}{!t.active && <span className="muted"> · inactive</span>}{t.id === SIL_ID && silReplaced && <span className="muted"> · replaced by {replacing?.name}</span>}</span>
                  <span className="muted">{t.legal_basis ?? "Halden policy"}{t.who ? ` · ${t.who}` : ""}</span>
                </span>
              </td>
              <td className="num r">
                {t.days}{t.calendar_days ? <span className="muted small"> cal.</span> : null}
                {t.statutory && t.days > t.legal_min_days && <span className="cell-sub">law: {t.legal_min_days}</span>}
              </td>
              <td className="col-md">{accrualLabel[t.accrual]}{t.min_service_months ? <span className="cell-sub">after {t.min_service_months} months</span> : null}</td>
              <td className="col-lg">
                {[t.paid ? "Paid" : "Unpaid", t.convertible && "unused days paid in cash", t.carry_over_max > 0 && `up to ${t.carry_over_max} roll over`, t.counts_as_sil && !t.statutory && "replaces service incentive leave", t.requires_document && `needs: ${t.requires_document}`].filter(Boolean).join(" · ")}
              </td>
              <td className="r"><Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page page-xl">
      <header className="page-head">
        <div>
          <h1>Leave policies</h1>
          <p className="muted">Leave required by Philippine law is the floor: you can give more days or better terms, never less. Add Halden’s own leave on top.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Add leave type</Button>
      </header>

      <section className="section">
        <h2>Halden’s leave</h2>
        {table(db.leave_types.filter((t) => !t.statutory))}
        {silReplaced && replacing && (
          <p className="check check-ok small">{replacing.name} gives at least 5 paid days a year, so it replaces service incentive leave (Labor Code Art. 95). Keep at least 5 days of it convertible to cash.</p>
        )}
      </section>
      <section className="section">
        <h2>Required by law</h2>
        {table(db.leave_types.filter((t) => t.statutory))}
        <p className="muted small">Maternity leave is advanced by Halden and reimbursed by SSS. Solo parent, VAWC and special leave for women apply only to people who qualify; HR checks the documents when approving.</p>
      </section>

      {editing && <LeaveTypeDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LeaveTypeDialog({ initial, onClose }: { initial: LeaveType | null; onClose: () => void }) {
  const legal = !!initial?.statutory;
  const min = initial?.legal_min_days ?? 0;
  const [f, setF] = useState<Omit<LeaveType, "id">>(initial ?? {
    name: "", statutory: false, legal_basis: null, legal_min_days: 0, days: 5, accrual: "annual", calendar_days: false, min_service_months: 0,
    paid: true, convertible: false, carry_over_max: 0, counts_as_sil: false, requires_document: null, who: null, description: null, active: true,
  });
  const [daysText, setDaysText] = useState(String(f.days));
  const [carryText, setCarryText] = useState(String(f.carry_over_max));
  const [serviceText, setServiceText] = useState(String(f.min_service_months));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = () => {
    const e: Record<string, string> = {};
    const days = Number(daysText), carry = Number(carryText || 0), service = Number(serviceText || 0);
    if (!f.name.trim()) e.name = "Name the leave as people will see it.";
    if (!Number.isFinite(days) || days <= 0) e.days = "Enter the number of days.";
    else if (days < min) e.days = `The law sets at least ${min} days (${initial?.legal_basis}). You can give more, not less.`;
    if (!Number.isFinite(carry) || carry < 0) e.carry = "Enter 0 or more.";
    if (!Number.isFinite(service) || service < 0) e.service = "Enter 0 or more months.";
    else if (legal && initial && service > initial.min_service_months) e.service = `The law allows it after ${initial.min_service_months} months. You can shorten the wait, not lengthen it.`;
    if (f.counts_as_sil && (!f.paid || days < 5)) e.days = "To replace service incentive leave it must be paid and at least 5 days a year.";
    setErrors(e);
    if (Object.keys(e).length) return;
    saveLeaveType({ ...f, id: initial?.id, name: f.name.trim(), days, carry_over_max: carry, min_service_months: service });
    onClose();
  };

  return (
    <Dialog
      title={initial ? `Edit ${initial.name}` : "Add leave type"}
      description={legal ? `Required by ${initial!.legal_basis}. You can make it more generous; the legal minimum stays.` : "A Halden policy, on top of what the law requires."}
      onClose={onClose}
      wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}
    >
      <div className="form-grid settings-form">
        <Field label="Name" error={errors.name}>
          {(id, d) => <input id={id} aria-describedby={d} value={f.name} disabled={legal} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label={f.accrual === "per_event" ? "Days each time" : "Days a year"} error={errors.days} hint={legal ? `At least ${min}` : undefined}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={daysText} onChange={(e) => setDaysText(e.target.value)} />}
        </Field>
        {!legal && (
          <Choice legend="How it’s earned" value={f.accrual} onChange={(v) => set("accrual", v)}
            options={(Object.keys(accrualLabel) as LeaveAccrual[]).map((k) => ({ value: k, label: accrualLabel[k] }))}
            hint={f.accrual === "monthly" ? "Days ÷ 12 earned at the end of each full month. Joiners start earning once they're eligible." : f.accrual === "annual" ? "Joiners and leavers get the share of the year they're eligible for." : "Granted for each event, like a death in the family."} />
        )}
        <Field label="Months of service before it can be used" error={errors.service}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={serviceText} onChange={(e) => setServiceText(e.target.value)} />}
        </Field>
        {f.accrual !== "per_event" && (
          <Field label="Days that roll over to next year" error={errors.carry}>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={carryText} onChange={(e) => setCarryText(e.target.value)} />}
          </Field>
        )}
        <Field label="Who it’s for">
          {(id) => <input id={id} value={f.who ?? ""} onChange={(e) => set("who", e.target.value || null)} />}
        </Field>
        <Field label="Documents needed">
          {(id) => <input id={id} value={f.requires_document ?? ""} onChange={(e) => set("requires_document", e.target.value || null)} />}
        </Field>
        {!legal && <Toggle label="Paid" checked={f.paid} onChange={(v) => set("paid", v)} hint="Unpaid leave is deducted from pay like an absence, and isn't counted toward the 13th month." />}
        {f.accrual !== "per_event" && f.paid && (
          <Toggle label="Pay unused days in cash" checked={f.convertible} onChange={(v) => set("convertible", v)} disabled={initial?.id === SIL_ID}
            hint="Paid with the December 16–31 payroll and in final pay. Up to 12 days of vacation leave a year is tax-free (RR 29-2025)." />
        )}
        {!legal && f.accrual !== "per_event" && (
          <Toggle label="Replaces service incentive leave" checked={f.counts_as_sil} onChange={(v) => set("counts_as_sil", v)}
            hint="Art. 95 exempts companies that already give at least 5 paid leave days a year. People then see this instead of SIL." />
        )}
        {!legal && <Toggle label="Active" checked={f.active} onChange={(v) => set("active", v)} />}
      </div>
    </Dialog>
  );
}
