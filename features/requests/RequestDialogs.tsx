"use client";

import { useMemo, useState, type FormEvent } from "react";
import { fileCorrection, fileOvertime, isPeriodLocked, useDb } from "@/lib/store";
import { addDays, formatDate } from "@/lib/format";
import { formatDuration, formatInstant, localToIso, shiftHours, spanMinutes, zoned } from "@/lib/time";
import type { CorrectionKind, Employee, ShiftCode } from "@/lib/types";
import { Button, Dialog, Field } from "@/components/ui";

const isWeekendDate = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

/** Turns a local date + "HH:MM" into an instant; an end time at or before the start rolls to the next day. */
function windowFor(date: string, start: string, end: string, tz: string) {
  const s = localToIso(date, start, tz);
  const e = localToIso(end <= start ? addDays(date, 1) : date, end, tz);
  return { start: s, end: e, minutes: (Date.parse(e) - Date.parse(s)) / 60000 };
}

export function OvertimeDialog({ employee, shift, managerial, initialDate, onClose, onDone }: {
  employee: Employee; shift: ShiftCode; managerial: boolean; initialDate?: string; onClose: () => void; onDone: () => void;
}) {
  const db = useDb();
  const today = zoned(Date.now(), shift.timezone).date;
  const defaultStart = shift.end_time;
  const [f, setF] = useState({ date: initialDate ?? today, start: defaultStart, end: addMinutes(defaultStart, 120), reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => { setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: "", window: "" })); };

  const w = windowFor(f.date, f.start, f.end, shift.timezone);
  const rest = isWeekendDate(f.date);
  const holiday = db.holidays.find((h) => h.date === f.date && h.kind !== "special_working");
  const schedStart = Date.parse(localToIso(f.date, shift.start_time, shift.timezone));
  const schedEnd = schedStart + spanMinutes(shift) * 60000;
  const overlapsSchedule = !rest && Date.parse(w.start) < schedEnd && Date.parse(w.end) > schedStart;
  const dayKind = holiday ? (holiday.kind === "regular" ? "regular holiday" : "special day") : rest ? "rest day" : "regular day";

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (isPeriodLocked(db, f.date)) e.date = "Payroll for this date is already finalized. Ask HR for a payroll adjustment instead.";
    if (w.minutes <= 0 || w.minutes > 12 * 60) e.window = "Overtime must be between a few minutes and 12 hours.";
    else if (overlapsSchedule) e.window = `This overlaps your shift (${shiftHours(shift)}). Overtime has to be outside your scheduled hours.`;
    if (f.reason.trim().length < 10) e.reason = "Say what the work was, in a sentence. Approvers need it to decide.";
    const clash = db.overtime_requests.some((r) => r.employee_id === employee.id && (r.status === "pending" || r.status === "approved") && Date.parse(r.start_at) < Date.parse(w.end) && Date.parse(r.end_at) > Date.parse(w.start));
    if (clash) e.window = "You already have a pending or approved request for this time.";
    setErrors(e);
    if (Object.keys(e).length) return;
    fileOvertime({ employee_id: employee.id, work_date: f.date, start_at: w.start, end_at: w.end, reason: f.reason.trim() });
    onDone();
  };

  if (managerial) {
    return (
      <Dialog title="File overtime" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
        <p>Your role is classed as managerial, so overtime, night differential and holiday premiums don’t apply (Labor Code Art. 82). Talk to HR if you think this classification is wrong.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="File overtime"
      description="Overtime is paid only after it’s approved, and only for time your records show you worked."
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="ot-form">Submit for approval</Button></>}
    >
      <form id="ot-form" className="form-grid" onSubmit={submit} noValidate>
        <div className="span-2">
          <Field label="Date" error={errors.date} hint={`${formatDate(f.date)} is a ${dayKind}${holiday ? ` (${holiday.name})` : ""}.`}>
            {(id, d) => <input id={id} type="date" aria-describedby={d} value={f.date} max={addDays(today, 30)} onChange={(e) => set("date", e.target.value)} />}
          </Field>
        </div>
        <Field label="From">
          {(id) => <input id={id} type="time" value={f.start} onChange={(e) => set("start", e.target.value)} />}
        </Field>
        <Field label="To" error={errors.window}>
          {(id, d) => <input id={id} type="time" aria-describedby={d} aria-invalid={!!errors.window} value={f.end} onChange={(e) => set("end", e.target.value)} />}
        </Field>
        <div className="span-2">
          <Field label="What was the work?" error={errors.reason}>
            {(id, d) => <textarea id={id} rows={3} aria-describedby={d} aria-invalid={!!errors.reason} value={f.reason} onChange={(e) => set("reason", e.target.value)} />}
          </Field>
        </div>
        {w.minutes > 0 && !errors.window && (
          <p className="span-2 muted">
            {formatDuration(w.minutes)}, {formatInstant(w.start, shift.timezone)} to {formatInstant(w.end, shift.timezone)}{f.end <= f.start ? " the next day" : ""}.
            {" "}{rest || holiday ? `Work on a ${dayKind} is paid at its premium rate.` : "Paid at 125% of your hourly rate."}
          </p>
        )}
      </form>
    </Dialog>
  );
}

const kindLabel: Record<CorrectionKind, string> = {
  missing_in: "Missing time in",
  missing_out: "Missing time out",
  wrong_in: "Wrong time in",
  wrong_out: "Wrong time out",
};

export function CorrectionDialog({ employee, shift, initialDate, initialKind, onClose, onDone }: {
  employee: Employee; shift: ShiftCode; initialDate?: string; initialKind?: CorrectionKind; onClose: () => void; onDone: () => void;
}) {
  const db = useDb();
  const today = zoned(Date.now(), shift.timezone).date;
  const [f, setF] = useState({ date: initialDate ?? today, kind: initialKind ?? ("missing_out" as CorrectionKind), time: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => { setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  const recordKind = f.kind.endsWith("_in") ? "clock_in" : "clock_out";
  const existing = useMemo(
    () => db.time_records.filter((r) => r.employee_id === employee.id && r.work_date === f.date && r.kind === recordKind).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0],
    [db.time_records, employee.id, f.date, recordKind],
  );
  const defaultTime = recordKind === "clock_in" ? shift.start_time : shift.end_time;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const time = f.time || defaultTime;
    if (f.date > today) e.date = "You can only correct days that have already happened.";
    else if (isPeriodLocked(db, f.date)) e.date = "Payroll for this date is already finalized. Ask HR for a payroll adjustment instead.";
    if (f.kind.startsWith("missing") && existing) e.kind = `There is already a ${recordKind === "clock_in" ? "time in" : "time out"} at ${formatInstant(existing.recorded_at, shift.timezone)}. Choose “Wrong time” instead.`;
    if (f.kind.startsWith("wrong") && !existing) e.kind = "There’s no record to fix on this day. Choose “Missing time” instead.";
    if (f.reason.trim().length < 10) e.reason = "Explain what happened, in a sentence.";
    if (db.correction_requests.some((r) => r.employee_id === employee.id && r.work_date === f.date && r.kind === f.kind && r.status === "pending")) e.kind = "You already have a pending request for this.";
    setErrors(e);
    if (Object.keys(e).length) return;
    // Overnight shifts: a time-out earlier than the shift start belongs to the next calendar day.
    const day = recordKind === "clock_out" && shift.end_time <= shift.start_time && time < shift.start_time ? addDays(f.date, 1) : f.date;
    const proposed = localToIso(day, time, shift.timezone);
    if (new Date(proposed).getTime() > Date.now()) { setErrors({ time: "That time hasn’t happened yet. Record it with Record time when it does." }); return; }
    fileCorrection({ employee_id: employee.id, work_date: f.date, kind: f.kind, proposed_at: proposed, reason: f.reason.trim() });
    onDone();
  };

  return (
    <Dialog
      title="Request a time correction"
      description="Your original record stays on file. If approved, the corrected time is added next to it."
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="corr-form">Submit for approval</Button></>}
    >
      <form id="corr-form" className="form-grid" onSubmit={submit} noValidate>
        <Field label="Date" error={errors.date}>
          {(id, d) => <input id={id} type="date" aria-describedby={d} value={f.date} max={today} onChange={(e) => set("date", e.target.value)} />}
        </Field>
        <Field label="Correct time" hint={`Your shift: ${shiftHours(shift)}`} error={errors.time}>
          {(id, d) => <input id={id} type="time" aria-describedby={d} value={f.time || defaultTime} onChange={(e) => set("time", e.target.value)} />}
        </Field>
        <div className="span-2">
          <fieldset className="segmented">
            <legend>What needs fixing?</legend>
            {(Object.keys(kindLabel) as CorrectionKind[]).map((k) => (
              <label key={k} className={f.kind === k ? "seg-on" : ""}>
                <input type="radio" name="kind" checked={f.kind === k} onChange={() => set("kind", k)} />
                {kindLabel[k]}
              </label>
            ))}
          </fieldset>
          <p className={`field-hint ${errors.kind ? "text-danger" : ""}`}>
            {errors.kind ?? (existing ? `On file: ${recordKind === "clock_in" ? "time in" : "time out"} at ${formatInstant(existing.recorded_at, shift.timezone)}.` : `No ${recordKind === "clock_in" ? "time in" : "time out"} on file for this day.`)}
          </p>
        </div>
        <div className="span-2">
          <Field label="What happened?" error={errors.reason}>
            {(id, d) => <textarea id={id} rows={3} aria-describedby={d} aria-invalid={!!errors.reason} value={f.reason} onChange={(e) => set("reason", e.target.value)} />}
          </Field>
        </div>
      </form>
    </Dialog>
  );
}

export const correctionKindLabel = kindLabel;

function addMinutes(hm: string, m: number) {
  const [h, mm] = hm.split(":").map(Number);
  const t = (((h * 60 + mm + m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

