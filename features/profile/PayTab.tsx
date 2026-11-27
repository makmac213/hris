"use client";

import { useState } from "react";
import { addPayItem, endPayItem, setEmployeePayrollSettings, today, updateCompensation, useCurrentUser, useDb } from "@/lib/store";
import { NO_AUTH_NEEDED, RULES, isMinimumWageEarner, peso, rates } from "@/lib/payroll";
import { formatDate } from "@/lib/format";
import type { DeMinimisKind, DeductionCategory, EarningCategory, Employee, PayItem, PayItemSchedule } from "@/lib/types";
import { Button, Dialog, EmptyState, Field } from "@/components/ui";
import { Choice, Toggle } from "@/features/payroll/SettingsDialog";

export const earningLabel: Record<EarningCategory, string> = {
  taxable_allowance: "Allowance (taxable)",
  de_minimis: "De minimis benefit",
  other_benefit: "Bonus or other benefit",
  commission: "Commission",
  reimbursement: "Reimbursement",
  adjustment: "Pay adjustment",
};
export const deductionLabel: Record<DeductionCategory, string> = {
  sss_loan: "SSS loan",
  pagibig_loan: "Pag-IBIG loan",
  company_loan: "Company loan or cash advance",
  union_dues: "Union dues",
  insurance: "Insurance premium",
  loss_damage: "Loss or damage",
  other_authorized: "Other authorized deduction",
};
const scheduleLabel: Record<PayItemSchedule, string> = {
  every_cutoff: "Every cutoff", first_cutoff: "1st–15th cutoff only", second_cutoff: "16th–end cutoff only", once: "Once",
};

export function PayTab({ employee }: { employee: Employee }) {
  const db = useDb();
  const [editComp, setEditComp] = useState(false);
  const [editContrib, setEditContrib] = useState(false);
  const [adding, setAdding] = useState(false);
  const comp = db.compensation.find((c) => c.employee_id === employee.id && c.on_ph_payroll);
  if (!comp) {
    return <EmptyState title="Not on Philippine payroll" body="This person is paid by another payroll, so there are no Philippine pay settings here." />;
  }
  const shift = db.shift_codes.find((s) => s.id === employee.shift_code_id);
  const s = db.payroll_settings;
  const rt = rates(comp, shift, s);
  const o = db.employee_payroll_settings.find((x) => x.employee_id === employee.id);
  const who = (v: boolean | null | undefined, company: boolean) => (v ?? company) ? `Company pays${v == null ? " (company setting)" : ""}` : `Employee pays${v == null ? " (company setting)" : ""}`;
  const items = db.pay_items.filter((p) => p.employee_id === employee.id).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const t = today();
  const active = items.filter((p) => !p.end_date || p.end_date >= t);
  const ended = items.filter((p) => p.end_date && p.end_date < t);

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
        <div className="panel-head"><h2>Allowances, benefits and deductions</h2><Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add item</Button></div>
        {active.length === 0 && ended.length === 0 && <p className="muted">Nothing besides salary. Add allowances, de minimis benefits, bonuses, loans or authorized deductions here.</p>}
        <div className="pay-items">
          {[...active, ...ended].map((p) => <PayItemRow key={p.id} item={p} ended={!!p.end_date && p.end_date < t} />)}
        </div>
      </section>

      {editComp && <CompensationDialog employee={employee} onClose={() => setEditComp(false)} />}
      {editContrib && <ContributionDialog employee={employee} onClose={() => setEditContrib(false)} />}
      {adding && <PayItemDialog employee={employee} onClose={() => setAdding(false)} />}
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

function PayItemDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { employee: me } = useCurrentUser();
  const [direction, setDirection] = useState<"earning" | "deduction">("earning");
  const [category, setCategory] = useState<string>("taxable_allowance");
  const [kind, setKind] = useState<DeMinimisKind>("rice");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [schedule, setSchedule] = useState<PayItemSchedule>("every_cutoff");
  const [start, setStart] = useState(today());
  const [installments, setInstallments] = useState("");
  const [auth, setAuth] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cats = direction === "earning" ? earningLabel : deductionLabel;
  const needsAuth = direction === "deduction" && !NO_AUTH_NEEDED.includes(category as DeductionCategory);
  const loanLike = direction === "deduction" && ["sss_loan", "pagibig_loan", "company_loan"].includes(category);
  const hint: Record<string, string> = {
    taxable_allowance: "Transport, communication and similar allowances that aren’t liquidated. Taxable, and counted for SSS.",
    de_minimis: `Tax-free up to the RR 29-2025 ceiling; anything over counts toward the ₱90,000 yearly limit.`,
    other_benefit: "Bonuses, incentives and gifts. Tax-free up to ₱90,000 a year together with 13th month pay.",
    commission: "Taxable, and counted for SSS.",
    reimbursement: "Only for expenses backed by receipts. Not pay, so not taxed.",
    adjustment: "Pay owed from an earlier period, such as a late-approved correction. Taxable.",
    sss_loan: "Allowed by law. Use the monthly amortization from the SSS billing.",
    pagibig_loan: "Allowed by law. Use the amortization from Pag-IBIG.",
    company_loan: "Needs the employee’s signed authorization: purpose, amount, number of deductions (DO 195-18).",
    union_dues: "Needs a check-off authorization. Excluded from taxable pay.",
    insurance: "Premiums the company advanced, with the employee’s written consent.",
    loss_damage: "Only after the employee was heard and responsibility is shown. Capped at 20% of wages (Art. 114–115).",
    other_authorized: "Anything else needs a signed authorization, and the company can’t benefit from it (Art. 113).",
  };
  const dm = RULES.deMinimis[kind];

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
      employee_id: employee.id, direction, category: category as PayItem["category"], de_minimis_kind: category === "de_minimis" ? kind : null,
      label: label.trim(), amount: amt, schedule, start_date: start, end_date: null, installments: n, authorization: auth.trim() || null, created_by: me.id,
    });
    onClose();
  };

  return (
    <Dialog title="Add to pay" onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Add item</Button></>}>
      <div className="form-grid">
        <Choice legend="Type" value={direction} onChange={(v) => { setDirection(v); setCategory(v === "earning" ? "taxable_allowance" : "sss_loan"); }} options={[{ value: "earning", label: "Adds to pay" }, { value: "deduction", label: "Deducts from pay" }]} />
        <div className="span-2">
          <Field label="Kind" hint={hint[category]}>
            {(id, d) => (
              <select id={id} aria-describedby={d} value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
          </Field>
        </div>
        {category === "de_minimis" && (
          <div className="span-2">
            <Field label="Benefit" hint={dm.per === "ot_day" ? "Tax-free up to 30% of the basic daily wage for each day of overtime or night work." : `Tax-free up to ${peso(dm.cap)} per ${dm.per}.`}>
              {(id, d) => (
                <select id={id} aria-describedby={d} value={kind} onChange={(e) => { setKind(e.target.value as DeMinimisKind); if (!label) setLabel(RULES.deMinimis[e.target.value as DeMinimisKind].label); }}>
                  {Object.entries(RULES.deMinimis).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              )}
            </Field>
          </div>
        )}
        <Field label="Name on payslip" error={errors.label}>
          {(id, d) => <input id={id} aria-describedby={d} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field label="Amount per cutoff" error={errors.amount}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="When">
          {(id) => (
            <select id={id} value={schedule} onChange={(e) => setSchedule(e.target.value as PayItemSchedule)}>
              {Object.entries(scheduleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </Field>
        <Field label={schedule === "once" ? "Pay date falls in the cutoff of" : "Starting"} error={errors.start}>
          {(id, d) => <input id={id} aria-describedby={d} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
        </Field>
        {loanLike && schedule !== "once" && (
          <Field label="Number of deductions" hint="Leave empty to deduct until stopped." error={errors.installments}>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value)} />}
          </Field>
        )}
        {direction === "deduction" && (
          <div className="span-2">
            <Field label={needsAuth ? "Signed authorization" : "Reference (optional)"} hint={needsAuth ? "For example: Salary deduction authorization signed Nov 14, 2026." : undefined} error={errors.auth}>
              {(id, d) => <input id={id} aria-describedby={d} value={auth} onChange={(e) => setAuth(e.target.value)} />}
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
