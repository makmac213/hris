"use client";

import { useState } from "react";
import { addPayItem, endPayItem, setEmployeePayrollSettings, today, updateCompensation, useCurrentUser, useDb } from "@/lib/store";
import { NO_AUTH_NEEDED, RULES, isMinimumWageEarner, peso, rates, typeReaches } from "@/lib/payroll";
import Link from "next/link";
import { deductionLabel, earningLabel, scheduleLabel, treatmentHint, appliesToLabel } from "@/features/payroll/labels";
import { formatDate } from "@/lib/format";
import type { DeductionCategory, EarningCategory, Employee, PayItem, PayItemSchedule, PayItemType } from "@/lib/types";
import { Button, Dialog, EmptyState, Field } from "@/components/ui";
import { Choice, Toggle } from "@/features/payroll/SettingsDialog";


export function PayTab({ employee }: { employee: Employee }) {
  const db = useDb();
  const [editComp, setEditComp] = useState(false);
  const [editContrib, setEditContrib] = useState(false);
  const [adding, setAdding] = useState<{ type?: PayItemType } | null>(null);
  const { employee: me } = useCurrentUser();
  const comp = db.compensation.find((c) => c.employee_id === employee.id && c.on_ph_payroll);
  if (!comp) {
    return <EmptyState title="Not on Philippine payroll" body="This person is paid by another payroll, so there are no Philippine pay settings here." />;
  }
  const shift = db.shift_codes.find((s) => s.id === employee.shift_code_id);
  const s = db.payroll_settings;
  const rt = rates(comp, shift, s);
  const o = db.employee_payroll_settings.find((x) => x.employee_id === employee.id);
  const who = (v: boolean | null | undefined, company: boolean) => (v ?? company) ? `Company pays${v == null ? " (company setting)" : ""}` : `Employee pays${v == null ? " (company setting)" : ""}`;
  const items = db.pay_items.filter((p) => p.employee_id === employee.id && !(p.end_date && p.end_date < p.start_date)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const t = today();
  const companyWide = db.pay_item_types.filter((x) => x.active && x.applies_to !== "individual" && (typeReaches(x, comp.is_managerial) || items.some((i) => i.type_id === x.id)));
  const wideIds = new Set(companyWide.map((x) => x.id));
  const ownItems = items.filter((i) => !(i.type_id && wideIds.has(i.type_id))).sort((a, b) => Number(!!(a.end_date && a.end_date < t)) - Number(!!(b.end_date && b.end_date < t)));

  return (
    <div className="stack-lg" role="tabpanel" id="panel-pay" aria-labelledby="tab-pay">
      <section className="panel">
        <div className="panel-head"><h2>Compensation</h2><Button size="sm" onClick={() => setEditComp(true)}>Edit</Button></div>
        <dl className="dl dl-wide">
          <div><dt>Rate</dt><dd className="num">{peso(comp.rate)} {comp.pay_basis === "monthly" ? "a month" : "an hour"}</dd></div>
          <div><dt>Daily rate</dt><dd className="num">{peso(rt.daily)} <span className="muted">({comp.pay_basis === "monthly" ? `× 12 ÷ ${s.workdays_per_year}` : "× 8 hours"})</span></dd></div>
          <div><dt>Hourly rate</dt><dd className="num">{peso(rt.hourly)}</dd></div>
          <div><dt>Category</dt><dd>{comp.is_managerial ? "Managerial: no overtime, night differential or holiday premiums (Art. 82)" : "Rank-and-file"}</dd></div>
          {isMinimumWageEarner(comp, shift, s) && <div><dt>Tax</dt><dd>Minimum wage earner: exempt on the minimum wage, holiday pay and overtime</dd></div>}
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Government contributions</h2><Button size="sm" onClick={() => setEditContrib(true)}>Edit</Button></div>
        <dl className="dl dl-wide">
          <div><dt>SSS employee share</dt><dd>{who(o?.employer_pays_sss, s.employer_pays_sss)}</dd></div>
          <div><dt>PhilHealth employee share</dt><dd>{who(o?.employer_pays_philhealth, s.employer_pays_philhealth)}</dd></div>
          <div><dt>Pag-IBIG employee share</dt><dd>{who(o?.employer_pays_pagibig, s.employer_pays_pagibig)}</dd></div>
          <div><dt>Voluntary Pag-IBIG</dt><dd className="num">{o?.pagibig_voluntary ? `${peso(o.pagibig_voluntary)} a month, on top of the mandatory share` : "None"}</dd></div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Allowances, benefits and deductions</h2><Button size="sm" variant="primary" onClick={() => setAdding({})}>Add item</Button></div>
        {companyWide.length > 0 && (
          <>
            <h3 className="sub-h">From company policy</h3>
            <div className="pay-items">
              {companyWide.map((t) => {
                const own = items.find((i) => i.type_id === t.id);
                return (
                  <div key={t.id} className={`pay-item ${own && own.amount === 0 ? "pay-item-ended" : ""}`}>
                    <span className="cell-2">
                      <span>{t.name}</span>
                      <span className="muted">{appliesToLabel[t.applies_to]} · {scheduleLabel[t.default_schedule].toLowerCase()}{own ? (own.amount === 0 ? " · excluded for this person" : " · amount changed for this person") : ""}</span>
                    </span>
                    <span className="pay-item-side">
                      <span className="num pay-item-amt">{own?.amount === 0 ? "—" : `+${peso(own?.amount ?? t.default_amount ?? 0)}`}</span>
                      {own
                        ? <Button size="sm" variant="ghost" onClick={() => endPayItem(own.id, "1900-01-01")}>Use company default</Button>
                        : <>
                            <Button size="sm" variant="ghost" onClick={() => setAdding({ type: t })}>Change amount</Button>
                            <Button size="sm" variant="ghost" onClick={() => addPayItem({ type_id: t.id, employee_id: employee.id, direction: t.direction, category: t.category, de_minimis_kind: t.de_minimis_kind, label: t.name, amount: 0, schedule: t.default_schedule, start_date: employee.start_date, end_date: null, installments: null, authorization: null, created_by: me.id })}>Exclude</Button>
                          </>}
                    </span>
                  </div>
                );
              })}
            </div>
            <h3 className="sub-h">For this person</h3>
          </>
        )}
        {ownItems.length === 0 && <p className="muted">Nothing else besides salary. Add allowances, bonuses, loans or authorized deductions from <Link className="link" href="/payroll/pay-types">Halden’s pay types</Link>.</p>}
        <div className="pay-items">
          {ownItems.map((p) => <PayItemRow key={p.id} item={p} ended={!!p.end_date && p.end_date < t} />)}
        </div>
      </section>

      {editComp && <CompensationDialog employee={employee} onClose={() => setEditComp(false)} />}
      {editContrib && <ContributionDialog employee={employee} onClose={() => setEditContrib(false)} />}
      {adding && <PayItemDialog employee={employee} presetType={adding.type} onClose={() => setAdding(null)} />}
    </div>
  );
}

function PayItemRow({ item, ended }: { item: PayItem; ended: boolean }) {
  const cat = item.direction === "earning" ? earningLabel[item.category as EarningCategory] : deductionLabel[item.category as DeductionCategory];
  const needsAuth = item.direction === "deduction" && !NO_AUTH_NEEDED.includes(item.category as DeductionCategory);
  const bits = [
    cat,
    item.de_minimis_kind ? RULES.deMinimis[item.de_minimis_kind].label : null,
    item.schedule === "once" ? `once, ${formatDate(item.start_date)}` : `${scheduleLabel[item.schedule].toLowerCase()} from ${formatDate(item.start_date)}`,
    item.installments ? `${item.installments} installments` : null,
    ended ? `ended ${formatDate(item.end_date!)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className={`pay-item ${ended ? "pay-item-ended" : ""}`}>
      <span className="cell-2">
        <span>{item.label}</span>
        <span className="muted">{bits}</span>
        {needsAuth && !item.authorization && <span className="text-warn">No signed authorization on file, so it won’t be deducted.</span>}
      </span>
      <span className="pay-item-side">
        <span className={`num pay-item-amt ${item.direction === "deduction" ? "neg" : ""}`}>{item.direction === "deduction" ? "−" : "+"}{peso(item.amount)}</span>
        {!ended && item.schedule !== "once" && <Button size="sm" variant="ghost" onClick={() => endPayItem(item.id, today())}>Stop</Button>}
      </span>
    </div>
  );
}

function CompensationDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const db = useDb();
  const comp = db.compensation.find((c) => c.employee_id === employee.id)!;
  const [basis, setBasis] = useState(comp.pay_basis);
  const [rate, setRate] = useState(String(comp.rate));
  const [managerial, setManagerial] = useState(comp.is_managerial);
  const [error, setError] = useState("");
  const save = () => {
    const r = Number(rate.replace(/,/g, ""));
    if (!Number.isFinite(r) || r <= 0) return setError("Enter the rate in pesos.");
    updateCompensation(employee.id, { pay_basis: basis, rate: r, is_managerial: managerial });
    onClose();
  };
  return (
    <Dialog title="Edit compensation" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Choice legend="Paid" value={basis} onChange={setBasis} options={[{ value: "monthly", label: "Monthly" }, { value: "hourly", label: "Hourly" }]} />
        <div className="span-2">
          <Field label={basis === "monthly" ? "Monthly rate" : "Hourly rate"} error={error || undefined}>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={rate} onChange={(e) => { setRate(e.target.value); setError(""); }} />}
          </Field>
        </div>
        <Toggle label="Managerial employee" checked={managerial} onChange={setManagerial} hint="Only for people whose main duty is managing, who direct at least two others and can hire or fire (Art. 82). Overtime, night differential and holiday premiums don’t apply." />
      </div>
    </Dialog>
  );
}

type Who = "company_setting" | "employee" | "company";
const toWho = (v: boolean | null | undefined): Who => (v == null ? "company_setting" : v ? "company" : "employee");
const fromWho = (w: Who) => (w === "company_setting" ? null : w === "company");

function ContributionDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const db = useDb();
  const o = db.employee_payroll_settings.find((x) => x.employee_id === employee.id);
  const [sss, setSss] = useState<Who>(toWho(o?.employer_pays_sss));
  const [ph, setPh] = useState<Who>(toWho(o?.employer_pays_philhealth));
  const [pag, setPag] = useState<Who>(toWho(o?.employer_pays_pagibig));
  const [vol, setVol] = useState(String(o?.pagibig_voluntary ?? 0));
  const [error, setError] = useState("");
  const options = [{ value: "company_setting" as Who, label: "Company setting" }, { value: "employee" as Who, label: "Employee pays" }, { value: "company" as Who, label: "Company pays" }];
  const save = () => {
    const v = Number(vol.replace(/,/g, "") || 0);
    if (!Number.isFinite(v) || v < 0) return setError("Enter a peso amount, or 0.");
    setEmployeePayrollSettings(employee.id, { employer_pays_sss: fromWho(sss), employer_pays_philhealth: fromWho(ph), employer_pays_pagibig: fromWho(pag), pagibig_voluntary: v });
    onClose();
  };
  return (
    <Dialog title="Contributions for this person" description="Rates are set by law. Who pays the employee share, and any voluntary savings, can differ per person." onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Choice legend="SSS employee share" value={sss} onChange={setSss} options={options} />
        <Choice legend="PhilHealth employee share" value={ph} onChange={setPh} options={options} />
        <Choice legend="Pag-IBIG employee share" value={pag} onChange={setPag} options={options} />
        <div className="span-2">
          <Field label="Voluntary Pag-IBIG, per month" hint={error || "Extra savings the employee asked for, above the mandatory ₱200. Deducted after tax."} error={error || undefined}>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={vol} onChange={(e) => { setVol(e.target.value); setError(""); }} />}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function PayItemDialog({ employee, presetType, onClose }: { employee: Employee; presetType?: PayItemType; onClose: () => void }) {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const types = db.pay_item_types.filter((x) => x.active);
  const [typeId, setTypeId] = useState(presetType?.id ?? types.find((x) => x.direction === "earning")?.id ?? "");
  const type = types.find((x) => x.id === typeId);
  const [label, setLabel] = useState(presetType?.name ?? type?.name ?? "");
  const [amount, setAmount] = useState(presetType?.default_amount ? String(presetType.default_amount) : type?.default_amount ? String(type.default_amount) : "");
  const [schedule, setSchedule] = useState<PayItemSchedule>(presetType?.default_schedule ?? type?.default_schedule ?? "every_cutoff");
  const [start, setStart] = useState(presetType ? employee.start_date : today());
  const [installments, setInstallments] = useState("");
  const [auth, setAuth] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!type) return null;
  const needsAuth = type.direction === "deduction" && !NO_AUTH_NEEDED.includes(type.category as DeductionCategory);
  const loanLike = type.direction === "deduction" && ["sss_loan", "pagibig_loan", "company_loan"].includes(type.category);
  const pick = (id: string) => {
    const x = types.find((y) => y.id === id)!;
    setTypeId(id);
    setLabel(x.name);
    setAmount(x.default_amount ? String(x.default_amount) : "");
    setSchedule(x.default_schedule);
  };
  const treat = type.direction === "earning" ? earningLabel[type.category as EarningCategory] : deductionLabel[type.category as DeductionCategory];
  const dmNote = type.de_minimis_kind ? ` ${RULES.deMinimis[type.de_minimis_kind].label}.` : "";

  const save = () => {
    const e: Record<string, string> = {};
    const amt = Number(amount.replace(/,/g, ""));
    if (!label.trim()) e.label = "Name the item as it should appear on the payslip.";
    if (!Number.isFinite(amt) || amt <= 0) e.amount = "Enter a peso amount.";
    if (!start) e.start = "Choose a start date.";
    const n = installments ? Number(installments) : null;
    if (installments && (!Number.isInteger(n) || n! < 1)) e.installments = "Use a whole number of deductions.";
    if (needsAuth && auth.trim().length < 5) e.auth = "Describe the signed authorization on file. Without one, this can’t be deducted.";
    setErrors(e);
    if (Object.keys(e).length) return;
    addPayItem({
      type_id: type.id, employee_id: employee.id, direction: type.direction, category: type.category, de_minimis_kind: type.de_minimis_kind,
      label: label.trim(), amount: amt, schedule, start_date: start, end_date: null, installments: n, authorization: auth.trim() || null, created_by: me.id,
    });
    onClose();
  };

  return (
    <Dialog title={presetType ? `Change ${presetType.name} for this person` : "Add to pay"} onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{presetType ? "Save amount" : "Add item"}</Button></>}>
      <div className="form-grid">
        {!presetType && (
          <div className="span-2">
            <Field label="Pay type" hint={`${treat}.${dmNote} ${treatmentHint[type.category]}`}>
              {(id, d) => (
                <select id={id} aria-describedby={d} value={typeId} onChange={(ev) => pick(ev.target.value)}>
                  <optgroup label="Adds to pay">{types.filter((x) => x.direction === "earning").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                  <optgroup label="Deducts from pay">{types.filter((x) => x.direction === "deduction").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                </select>
              )}
            </Field>
            <p className="field-hint">Missing one? <Link className="link" href="/payroll/pay-types">Add a pay type</Link> with your own rules.</p>
          </div>
        )}
        <Field label="Name on payslip" error={errors.label}>
          {(id, d) => <input id={id} aria-describedby={d} value={label} onChange={(ev) => setLabel(ev.target.value)} />}
        </Field>
        <Field label="Amount per cutoff" error={errors.amount}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} />}
        </Field>
        <Field label="When">
          {(id) => (
            <select id={id} value={schedule} onChange={(ev) => setSchedule(ev.target.value as PayItemSchedule)}>
              {Object.entries(scheduleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </Field>
        <Field label={schedule === "once" ? "Pay date falls in the cutoff of" : "Starting"} error={errors.start}>
          {(id, d) => <input id={id} aria-describedby={d} type="date" value={start} onChange={(ev) => setStart(ev.target.value)} />}
        </Field>
        {loanLike && schedule !== "once" && (
          <Field label="Number of deductions" hint="Leave empty to deduct until stopped." error={errors.installments}>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={installments} onChange={(ev) => setInstallments(ev.target.value)} />}
          </Field>
        )}
        {type.direction === "deduction" && (
          <div className="span-2">
            <Field label={needsAuth ? "Signed authorization" : "Reference (optional)"} hint={needsAuth ? "For example: Salary deduction authorization signed Nov 14, 2026." : undefined} error={errors.auth}>
              {(id, d) => <input id={id} aria-describedby={d} value={auth} onChange={(ev) => setAuth(ev.target.value)} />}
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
