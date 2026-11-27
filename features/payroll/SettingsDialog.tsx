"use client";

import { useState, type ReactNode } from "react";
import { updatePayrollSettings, useDb } from "@/lib/store";
import { peso } from "@/lib/payroll";
import type { PayrollSettings } from "@/lib/types";
import { Button, Dialog, Field } from "@/components/ui";

export function Choice<T extends string | number>({ legend, value, options, onChange, hint }: {
  legend: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: ReactNode;
}) {
  return (
    <div className="span-2">
      <fieldset className="segmented">
        <legend>{legend}</legend>
        {options.map((o) => (
          <label key={String(o.value)} className={value === o.value ? "seg-on" : ""}>
            <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </fieldset>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <div className="span-2 toggle-row">
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function PayrollSettingsDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const [f, setF] = useState<PayrollSettings>(db.payroll_settings);
  const [wage, setWage] = useState(String(db.payroll_settings.minimum_wage_daily));
  const [error, setError] = useState("");
  const set = <K extends keyof PayrollSettings>(k: K, v: PayrollSettings[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = () => {
    const w = Number(wage);
    if (!Number.isFinite(w) || w <= 0) return setError("Enter the daily minimum wage in pesos.");
    updatePayrollSettings({ ...f, minimum_wage_daily: w });
    onClose();
  };

  return (
    <Dialog
      title="Payroll settings"
      description="Company-wide. Some of these can be changed for one person on their profile."
      onClose={onClose}
      wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save settings</Button></>}
    >
      <div className="form-grid settings-form">
        <h3 className="span-2 settings-h">Government contributions</h3>
        <Choice
          legend="When are they deducted?"
          value={f.contribution_timing}
          onChange={(v) => set("contribution_timing", v)}
          options={[{ value: "split", label: "Half each cutoff" }, { value: "second_cutoff", label: "All on the 16th–end cutoff" }, { value: "first_cutoff", label: "All on the 1st–15th cutoff" }]}
          hint="The law sets the monthly amount, not when in the month you deduct it."
        />
        <Choice
          legend="SSS and Pag-IBIG are based on"
          value={f.sss_basis}
          onChange={(v) => set("sss_basis", v)}
          options={[{ value: "actual_compensation", label: "The month’s actual compensation" }, { value: "monthly_rate", label: "The monthly rate only" }]}
          hint={f.sss_basis === "actual_compensation" ? "Includes overtime, premiums, night differential, commissions and taxable allowances (RA 11199 defines compensation as all actual pay). The first cutoff is estimated and the second trues it up. PhilHealth always uses basic salary." : "Simpler, but SSS can be under-remitted when people earn overtime or commissions."}
        />
        <Toggle label="Company pays the employee share of SSS" checked={f.employer_pays_sss} onChange={(v) => set("employer_pays_sss", v)} />
        <Toggle label="Company pays the employee share of PhilHealth" checked={f.employer_pays_philhealth} onChange={(v) => set("employer_pays_philhealth", v)} />
        <Toggle label="Company pays the employee share of Pag-IBIG" checked={f.employer_pays_pagibig} onChange={(v) => set("employer_pays_pagibig", v)} hint="A shouldered share isn’t deducted from pay. It is treated as taxable compensation for non-minimum-wage staff." />

        <h3 className="span-2 settings-h">Time and holidays</h3>
        <Choice
          legend="Daily rate of monthly-paid staff: monthly × 12 ÷"
          value={f.workdays_per_year}
          onChange={(v) => set("workdays_per_year", v)}
          options={[{ value: 261, label: "261 (5-day week)" }, { value: 313, label: "313 (6-day week)" }, { value: 365, label: "365 (paid every day)" }]}
        />
        <Toggle label="Pay unworked special non-working days" checked={f.pay_unworked_special_days} onChange={(v) => set("pay_unworked_special_days", v)} hint="The law says no work, no pay. Most companies with monthly salaries pay them anyway; turning this off deducts them." />
        <Toggle label="Deduct late and undertime for managerial staff" checked={f.deduct_managerial_tardiness} onChange={(v) => set("deduct_managerial_tardiness", v)} hint="Managerial staff are outside the hours-of-work rules (Art. 82). Absences are still unpaid." />
        <Toggle label="Pay 13th month to managerial staff" checked={f.thirteenth_month_for_managerial} onChange={(v) => set("thirteenth_month_for_managerial", v)} hint="PD 851 requires it for rank-and-file staff. Paying managers is company policy." />

        <h3 className="span-2 settings-h">Minimum wage</h3>
        <Field label="Daily minimum wage" hint={error || `Currently ${peso(f.minimum_wage_daily)} · ${f.minimum_wage_label}`} error={error || undefined}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" value={wage} onChange={(e) => { setWage(e.target.value); setError(""); }} />}
        </Field>
        <Field label="Wage order">
          {(id) => <input id={id} value={f.minimum_wage_label} onChange={(e) => set("minimum_wage_label", e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
