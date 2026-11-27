"use client";

import Link from "next/link";
import { useState } from "react";
import { savePayItemType, useCurrentUser, useDb } from "@/lib/store";
import { RULES, peso, typeReaches } from "@/lib/payroll";
import type { DeMinimisKind, DeductionCategory, EarningCategory, PayItemSchedule, PayItemType, PayTypeAppliesTo } from "@/lib/types";
import { Button, Dialog, EmptyState, Field, Icon } from "@/components/ui";
import { Choice, Toggle } from "./SettingsDialog";
import { appliesToLabel, deductionLabel, earningLabel, scheduleLabel, treatmentHint } from "./labels";

export function PayTypesView() {
  const db = useDb();
  const { canManage } = useCurrentUser();
  const [editing, setEditing] = useState<PayItemType | "new-earning" | "new-deduction" | null>(null);
  if (!canManage) return <div className="page"><EmptyState title="Only admins and HR can manage pay types" body="Your payslips are on the My pay page." /></div>;

  const reach = (t: PayItemType) => {
    if (t.applies_to === "individual" || t.direction === "deduction") return db.pay_items.filter((i) => i.type_id === t.id && i.amount > 0 && (!i.end_date || i.end_date >= new Date().toISOString().slice(0, 10))).length;
    return db.employees.filter((e) => {
      const c = db.compensation.find((x) => x.employee_id === e.id && x.on_ph_payroll);
      if (!c || e.status === "offboarded") return false;
      const own = db.pay_items.find((i) => i.type_id === t.id && i.employee_id === e.id);
      return own ? own.amount > 0 : typeReaches(t, c.is_managerial);
    }).length;
  };

  const table = (direction: "earning" | "deduction") => {
    const rows = db.pay_item_types.filter((t) => t.direction === direction).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="col-md">Treated as</th>
              <th className="col-lg">Who gets it</th>
              <th className="num r">Default</th>
              <th className="num r col-md">People</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.active ? "" : "row-muted"}>
                <td>
                  <span className="cell-2">
                    <span>{t.name}{!t.active && <span className="muted"> · inactive</span>}{t.is_statutory && <span className="muted"> · set by law</span>}</span>
                    {t.description && <span className="muted">{t.description}</span>}
                  </span>
                </td>
                <td className="col-md">
                  <span className="cell-2">
                    <span>{direction === "earning" ? earningLabel[t.category as EarningCategory] : deductionLabel[t.category as DeductionCategory]}</span>
                    {t.de_minimis_kind && <span className="muted">{RULES.deMinimis[t.de_minimis_kind].label}</span>}
                    {t.counts_for_13th && <span className="muted">Counts toward 13th month</span>}
                  </span>
                </td>
                <td className="col-lg">{direction === "deduction" ? "Person by person, with consent" : appliesToLabel[t.applies_to]}</td>
                <td className="num r">{t.default_amount ? <>{peso(t.default_amount)}<span className="muted small"> · {scheduleLabel[t.default_schedule].toLowerCase()}</span></> : "—"}</td>
                <td className="num r col-md">{reach(t)}</td>
                <td className="r"><Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="page page-xl">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/payroll">Payroll</Link>
        <Icon name="chevronRight" size={14} />
        <span aria-current="page">Pay types</span>
      </nav>
      <header className="page-head">
        <div>
          <h1>Pay types</h1>
          <p className="muted">Halden’s own allowances, benefits, bonuses and deductions. Name them and set who gets them; each one is taxed the way the law treats its kind.</p>
        </div>
      </header>

      <section className="section">
        <div className="section-head"><h2>Adds to pay</h2><Button variant="primary" onClick={() => setEditing("new-earning")}>Add earning type</Button></div>
        {table("earning")}
      </section>
      <section className="section">
        <div className="section-head"><h2>Deducts from pay</h2><Button onClick={() => setEditing("new-deduction")}>Add deduction type</Button></div>
        {table("deduction")}
        <p className="muted small">Deductions are always set up person by person, because each one needs that person’s signed authorization, except SSS and Pag-IBIG loans (Art. 113).</p>
      </section>

      {editing && <TypeDialog initial={typeof editing === "string" ? null : editing} direction={typeof editing === "string" ? (editing === "new-earning" ? "earning" : "deduction") : editing.direction} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TypeDialog({ initial, direction, onClose }: { initial: PayItemType | null; direction: "earning" | "deduction"; onClose: () => void }) {
  const locked = !!initial?.is_statutory;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState<string>(initial?.category ?? (direction === "earning" ? "taxable_allowance" : "company_loan"));
  const [kind, setKind] = useState<DeMinimisKind>(initial?.de_minimis_kind ?? "rice");
  const [amount, setAmount] = useState(initial?.default_amount ? String(initial.default_amount) : "");
  const [schedule, setSchedule] = useState<PayItemSchedule>(initial?.default_schedule ?? "every_cutoff");
  const [appliesTo, setAppliesTo] = useState<PayTypeAppliesTo>(initial?.applies_to ?? "individual");
  const [counts13, setCounts13] = useState(initial?.counts_for_13th ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cats = direction === "earning" ? earningLabel : (Object.fromEntries(Object.entries(deductionLabel).filter(([k]) => locked || (k !== "sss_loan" && k !== "pagibig_loan"))) as Record<string, string>);
  const dm = RULES.deMinimis[kind];

  const save = () => {
    const e: Record<string, string> = {};
    const amt = amount ? Number(amount.replace(/,/g, "")) : null;
    if (!name.trim()) e.name = "Give it the name people will see on payslips.";
    if (amount && (!Number.isFinite(amt) || amt! <= 0)) e.amount = "Enter a peso amount, or leave it empty.";
    if (direction === "earning" && appliesTo !== "individual" && !amt) e.amount = "A type that goes to everyone needs a default amount.";
    setErrors(e);
    if (Object.keys(e).length) return;
    savePayItemType({
      id: initial?.id, name: name.trim(), direction, category: category as PayItemType["category"], de_minimis_kind: category === "de_minimis" ? kind : null,
      description: description.trim() || null, default_amount: amt, default_schedule: schedule, applies_to: direction === "earning" ? appliesTo : "individual",
      counts_for_13th: direction === "earning" && counts13, is_statutory: locked, active,
    });
    onClose();
  };

  return (
    <Dialog
      title={initial ? `Edit ${initial.name}` : direction === "earning" ? "New earning type" : "New deduction type"}
      description={initial ? "Changes apply from the next payroll you run. Finalized payrolls keep what they paid." : undefined}
      onClose={onClose}
      wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{initial ? "Save type" : "Add type"}</Button></>}
    >
      <div className="form-grid">
        <Field label="Name" error={errors.name}>
          {(id, d) => <input id={id} aria-describedby={d} value={name} onChange={(ev) => setName(ev.target.value)} placeholder={direction === "earning" ? "e.g. Meal allowance" : "e.g. Cooperative share"} />}
        </Field>
        <Field label="Treated as" hint={locked ? "Set by law." : undefined}>
          {(id, d) => (
            <select id={id} aria-describedby={d} value={category} disabled={locked} onChange={(ev) => setCategory(ev.target.value)}>
              {Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </Field>
        <p className="span-2 field-hint treatment-hint">{treatmentHint[category]}</p>
        {category === "de_minimis" && (
          <div className="span-2">
            <Field label="Which de minimis benefit" hint={dm.per === "ot_day" ? "Tax-free up to 30% of the basic daily wage for each day of overtime or night work." : `Tax-free up to ${peso(dm.cap)} per ${dm.per}.`}>
              {(id, d) => (
                <select id={id} aria-describedby={d} value={kind} onChange={(ev) => setKind(ev.target.value as DeMinimisKind)}>
                  {Object.entries(RULES.deMinimis).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              )}
            </Field>
          </div>
        )}
        <div className="span-2">
          <Field label="Description (optional)" hint="Your policy in a sentence: who it’s for, how much, when.">
            {(id, d) => <input id={id} aria-describedby={d} value={description} onChange={(ev) => setDescription(ev.target.value)} />}
          </Field>
        </div>
        <Field label="Default amount per cutoff" hint="Pre-filled when added to a person; they can differ." error={errors.amount}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} />}
        </Field>
        <Field label="Usually paid">
          {(id) => (
            <select id={id} value={schedule} onChange={(ev) => setSchedule(ev.target.value as PayItemSchedule)}>
              {Object.entries(scheduleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </Field>
        {direction === "earning" && (
          <>
            <Choice
              legend="Who gets it"
              value={appliesTo}
              onChange={setAppliesTo}
              options={(Object.keys(appliesToLabel) as PayTypeAppliesTo[]).map((k) => ({ value: k, label: appliesToLabel[k] }))}
              hint={appliesTo === "individual" ? "Add it on each person’s profile." : "Everyone in the group gets the default amount. Change the amount for one person, or exclude them, on their profile."}
            />
            <Toggle label="Count it toward the 13th month" checked={counts13} onChange={setCounts13} hint="PD 851 counts basic salary only. Including more is allowed as company practice, never less." />
          </>
        )}
        <Toggle label="Active" checked={active} onChange={setActive} hint="Turning it off stops it on future payrolls. People’s past payslips keep it." />
      </div>
    </Dialog>
  );
}
