"use client";

import { useState, type FormEvent } from "react";
import { createEmployee, today, useDb } from "@/lib/store";
import { addDays, displayName, employmentTypeLabel } from "@/lib/format";
import type { EmploymentType } from "@/lib/types";
import { Button, Dialog, Field } from "@/components/ui";

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, "");

export function AddEmployeeDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const db = useDb();
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    work_email: "",
    job_title: "",
    department_id: "",
    location_id: "",
    manager_id: "",
    start_date: addDays(today(), 14),
    employment_type: "full_time" as EmploymentType,
  });
  const [emailTouched, setEmailTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof f, v: string) => {
    setF((prev) => {
      const next = { ...prev, [k]: v };
      if ((k === "first_name" || k === "last_name") && !emailTouched && next.first_name && next.last_name) {
        next.work_email = `${slug(next.first_name)}.${slug(next.last_name)}@halden.co`;
      }
      if (k === "department_id" && !prev.manager_id) {
        next.manager_id = db.departments.find((d) => d.id === v)?.head_id ?? "";
      }
      return next;
    });
    setErrors((e) => ({ ...e, [k]: "", ...(k === "first_name" || k === "last_name" ? { work_email: "" } : {}) }));
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!f.first_name.trim()) e.first_name = "Enter a first name.";
    if (!f.last_name.trim()) e.last_name = "Enter a last name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.work_email)) e.work_email = "Enter an email like name@halden.co.";
    else if (db.employees.some((x) => x.work_email === f.work_email)) e.work_email = "Someone already uses this email.";
    if (!f.job_title.trim()) e.job_title = "Enter a job title.";
    if (!f.department_id) e.department_id = "Choose a department.";
    if (!f.location_id) e.location_id = "Choose a location.";
    if (!f.start_date) e.start_date = "Choose a start date.";
    setErrors(e);
    if (Object.keys(e).length) return;
    const emp = createEmployee({ ...f, first_name: f.first_name.trim(), last_name: f.last_name.trim(), job_title: f.job_title.trim(), manager_id: f.manager_id || null });
    onCreated(emp.id);
  };

  const managers = db.employees.filter((e) => e.status === "active").sort((a, b) => displayName(a).localeCompare(displayName(b)));

  return (
    <Dialog
      title="Add employee"
      description="We’ll create their profile and a standard onboarding checklist."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-employee">Add and start onboarding</Button>
        </>
      }
    >
      <form id="add-employee" className="form-grid" onSubmit={submit} noValidate>
        <Field label="First name" error={errors.first_name}>
          {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!errors.first_name} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Last name" error={errors.last_name}>
          {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!errors.last_name} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} autoComplete="off" />}
        </Field>
        <div className="span-2">
          <Field label="Work email" error={errors.work_email} hint="Filled in from their name. Change it if needed.">
            {(id, d) => <input id={id} type="email" aria-describedby={d} aria-invalid={!!errors.work_email} value={f.work_email} onChange={(e) => { setEmailTouched(true); set("work_email", e.target.value); }} />}
          </Field>
        </div>
        <div className="span-2">
          <Field label="Job title" error={errors.job_title}>
            {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!errors.job_title} value={f.job_title} onChange={(e) => set("job_title", e.target.value)} />}
          </Field>
        </div>
        <Field label="Department" error={errors.department_id}>
          {(id, d) => (
            <select id={id} aria-describedby={d} aria-invalid={!!errors.department_id} value={f.department_id} onChange={(e) => set("department_id", e.target.value)}>
              <option value="">Choose…</option>
              {db.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Location" error={errors.location_id}>
          {(id, d) => (
            <select id={id} aria-describedby={d} aria-invalid={!!errors.location_id} value={f.location_id} onChange={(e) => set("location_id", e.target.value)}>
              <option value="">Choose…</option>
              {db.locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Manager" hint="Defaults to the department head.">
          {(id, d) => (
            <select id={id} aria-describedby={d} value={f.manager_id} onChange={(e) => set("manager_id", e.target.value)}>
              <option value="">No manager</option>
              {managers.map((x) => <option key={x.id} value={x.id}>{displayName(x)}</option>)}
            </select>
          )}
        </Field>
        <Field label="Start date" error={errors.start_date}>
          {(id, d) => <input id={id} type="date" aria-describedby={d} value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />}
        </Field>
        <div className="span-2">
          <fieldset className="segmented">
            <legend>Employment type</legend>
            {(Object.keys(employmentTypeLabel) as EmploymentType[]).map((t) => (
              <label key={t} className={f.employment_type === t ? "seg-on" : ""}>
                <input type="radio" name="employment_type" value={t} checked={f.employment_type === t} onChange={() => set("employment_type", t)} />
                {employmentTypeLabel[t]}
              </label>
            ))}
          </fieldset>
        </div>
      </form>
    </Dialog>
  );
}
