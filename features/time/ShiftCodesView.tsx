"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { addShiftCodes, archiveShiftCode, assignShift, setDefaultShift, useCurrentUser, useDb } from "@/lib/store";
import { displayName } from "@/lib/format";
import type { ShiftCode, ShiftKind } from "@/lib/types";
import {
  CSV_TEMPLATE, DEFAULT_SPAN, ORG_TZ, formatDuration, fromMinutes, parseShiftCsv, shiftHours, shiftKindLabel, spanMinutes, toMinutes, type ParsedRow,
} from "@/lib/time";
import { Button, Dialog, EmptyState, Field, Icon, PersonCell, SearchInput, Blank, RowMenu } from "@/components/ui";
import { paidMinutes, sourceLabel } from "./shared";

export function ShiftCodesView() {
  const db = useDb();
  const { canManage } = useCurrentUser();
  const [dialog, setDialog] = useState<null | "upload" | "add" | { assign: ShiftCode }>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState("");

  const assigned = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of db.employees) if (e.shift_code_id && e.status !== "offboarded") m.set(e.shift_code_id, (m.get(e.shift_code_id) ?? 0) + 1);
    return m;
  }, [db.employees]);

  if (!canManage) {
    return (
      <div className="page">
        <EmptyState title="Only admins and HR can manage shift codes" body="Your shift is on the My time page." action={<Link href="/my-time" className="btn btn-secondary btn-md">Go to My time</Link>} />
      </div>
    );
  }

  const unassigned = db.employees.filter((e) => !e.shift_code_id && (e.status === "active" || e.status === "onboarding")).length;
  const archivedCount = db.shift_codes.filter((s) => s.archived_at).length;
  const visible = db.shift_codes.filter((s) => showArchived || !s.archived_at);
  const groups: { title: string; rows: ShiftCode[] }[] = [
    { title: "Philippine defaults", rows: visible.filter((s) => s.source === "system_default") },
    { title: "Your shift codes", rows: visible.filter((s) => s.source !== "system_default") },
  ];

  const table = (rows: ShiftCode[]) => (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Hours</th>
            <th className="col-md">Type</th>
            <th className="col-lg num">Paid</th>
            <th className="col-md num">People</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className={s.archived_at ? "row-archived" : ""}>
              <td>
                <span className="cell-2">
                  <span className="code-line">
                    <span className="code">{s.code}</span>
                    {s.is_default && <span className="badge badge-onboarding">Default</span>}
                    {s.archived_at && <span className="badge badge-offboarded">Archived</span>}
                  </span>
                  <span className="muted">{s.name}{s.timezone !== ORG_TZ && ` · ${s.timezone.split("/")[1].replace("_", " ")} time`}</span>
                </span>
              </td>
              <td className="num">{shiftHours(s)}</td>
              <td className="col-md nowrap">{shiftKindLabel[s.kind]}</td>
              <td className="col-lg num">{formatDuration(paidMinutes(s))}{s.break_minutes > 0 && <span className="muted"> + {s.break_minutes}m break</span>}</td>
              <td className="col-md num">{assigned.get(s.id) ?? 0}</td>
              <td className="actions-cell">
                {!s.archived_at && <Button size="sm" onClick={() => setDialog({ assign: s })}>Assign people</Button>}
                <RowMenu
                  label={`More actions for ${s.code}`}
                  items={[
                    ...(!s.archived_at && !s.is_default ? [{ label: "Make default for new hires", run: () => { setDefaultShift(s.id); setNotice(`${s.code} is now the default for new hires.`); } }] : []),
                    ...(!s.is_default ? [{ label: s.archived_at ? "Restore" : "Archive", run: () => { archiveShiftCode(s.id, !s.archived_at); setNotice(s.archived_at ? `${s.code} restored.` : `${s.code} archived. ${assigned.get(s.id) ?? 0} people keep it until you reassign them.`); } }] : []),
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Shift codes</h1>
          <p className="muted">
            Whole-day shifts default to 9 hours: 8 paid plus a 1-hour meal break. Half-day shifts are 4 hours.
            {unassigned > 0 && <> · <span className="text-warn">{unassigned} people have no shift code</span></>}
          </p>
        </div>
        <div className="head-actions">
          <Button icon="upload" onClick={() => setDialog("upload")}>Upload CSV</Button>
          <Button variant="primary" icon="plus" onClick={() => setDialog("add")}>Add shift code</Button>
        </div>
      </header>

      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={18} /> <span>{notice}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice("")}><Icon name="x" size={16} /></button>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.title} className="section">
          <h2>{g.title} <span className="count">{g.rows.length}</span></h2>
          {g.rows.length ? table(g.rows) : (
            <EmptyState
              title="No custom shift codes yet"
              body="Upload a CSV of start and end times, or add codes one at a time. Custom codes sit alongside the Philippine defaults."
              action={<Button icon="upload" onClick={() => setDialog("upload")}>Upload CSV</Button>}
            />
          )}
        </section>
      ))}

      {archivedCount > 0 && (
        <button type="button" className="link archived-toggle" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "Hide archived codes" : `Show ${archivedCount} archived ${archivedCount === 1 ? "code" : "codes"}`}
        </button>
      )}

      {dialog === "upload" && <UploadDialog onClose={() => setDialog(null)} onDone={(n) => { setDialog(null); setNotice(`Imported ${n} shift ${n === 1 ? "code" : "codes"}.`); }} />}
      {dialog === "add" && <AddShiftDialog onClose={() => setDialog(null)} onDone={(c) => { setDialog(null); setNotice(`${c} added.`); }} />}
      {dialog && typeof dialog === "object" && <AssignDialog shift={dialog.assign} onClose={() => setDialog(null)} onDone={(n) => { setDialog(null); setNotice(`${dialog.assign.code} assigned to ${n} ${n === 1 ? "person" : "people"}.`); }} />}
    </div>
  );
}

// ---- Upload ------------------------------------------------------------------

function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const db = useDb();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [copied, setCopied] = useState(false);
  const existing = useMemo(() => new Set(db.shift_codes.map((s) => s.code)), [db.shift_codes]);

  const onFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setRows(parseShiftCsv(await f.text(), existing));
  };
  const valid = rows?.filter((r) => r.value) ?? [];
  const invalid = rows?.filter((r) => !r.value) ?? [];

  const copy = async () => {
    try { await navigator.clipboard.writeText(CSV_TEMPLATE); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <Dialog
      title="Upload shift codes"
      description="One shift per row. Times can be 24-hour (17:00) or 12-hour (5:00 PM). End before start means the shift ends the next day."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid.length} onClick={() => { addShiftCodes(valid.map((r) => ({ ...r.value!, source: "uploaded" }))); onDone(valid.length); }}>
            {valid.length ? `Import ${valid.length} shift ${valid.length === 1 ? "code" : "codes"}` : "Import"}
          </Button>
        </>
      }
    >
      <div className="stack-md">
        <label className="dropzone">
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
          <Icon name="upload" />
          <span><strong>{fileName || "Choose a CSV file"}</strong><span className="muted">{fileName ? "Choose another file" : "Columns: code, name, type, start, end, break_minutes"}</span></span>
        </label>

        {!rows && (
          <div className="template">
            <div className="template-head">
              <span className="muted">Template</span>
              <Button size="sm" variant="ghost" onClick={copy}>{copied ? "Copied" : "Copy template"}</Button>
            </div>
            <pre>{CSV_TEMPLATE}</pre>
          </div>
        )}

        {rows && rows.length === 0 && <p className="text-danger">This file has no rows.</p>}
        {rows && rows.length > 0 && (
          <>
            <p className={invalid.length ? "text-warn" : "muted"}>
              {valid.length} ready to import{invalid.length > 0 && `, ${invalid.length} with problems will be skipped`}.
            </p>
            <div className="table-wrap preview-table">
              <table className="table">
                <thead><tr><th className="num">Row</th><th>Code</th><th>Hours</th><th>Check</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line}>
                      <td className="num muted">{r.line}</td>
                      <td>{r.value ? <span className="code">{r.value.code}</span> : <Blank />}</td>
                      <td className="num">{r.value ? `${shiftHours(r.value as ShiftCode)} · ${shiftKindLabel[r.value.kind]}` : <Blank />}</td>
                      <td>{r.errors.length ? <span className="text-danger">{r.errors.join(". ")}</span> : <span className="ok-text"><Icon name="check" size={16} /> Ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---- Add one -----------------------------------------------------------------

function AddShiftDialog({ onClose, onDone }: { onClose: () => void; onDone: (code: string) => void }) {
  const db = useDb();
  const [f, setF] = useState({ code: "", name: "", kind: "whole_day" as ShiftKind, start: "08:00", end: "17:00", brk: "60", grace: "5" });
  const [endTouched, setEndTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof f, v: string) => {
    setF((p) => {
      const n = { ...p, [k]: v };
      if ((k === "start" || k === "kind") && !endTouched && n.start) n.end = fromMinutes(toMinutes(n.start) + DEFAULT_SPAN[n.kind as ShiftKind].span);
      if (k === "kind") n.brk = String(DEFAULT_SPAN[v as ShiftKind].break);
      return n;
    });
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const span = f.start && f.end && f.start !== f.end ? spanMinutes({ start_time: f.start, end_time: f.end }) : 0;
  const expected = DEFAULT_SPAN[f.kind].span;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const code = f.code.trim().toUpperCase();
    const e: Record<string, string> = {};
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) e.code = "Use 2–20 letters, digits or dashes, like OPS-D0730.";
    else if (db.shift_codes.some((s) => s.code === code)) e.code = `${code} already exists.`;
    if (!f.name.trim()) e.name = "Enter a name people will recognize.";
    if (!span) e.end = "End time must differ from start time.";
    else if (Number(f.brk) >= span) e.brk = "Break must be shorter than the shift.";
    setErrors(e);
    if (Object.keys(e).length) return;
    addShiftCodes([{ code, name: f.name.trim(), kind: f.kind, start_time: f.start, end_time: f.end, break_minutes: Number(f.brk) || 0, grace_minutes: Number(f.grace) || 0, timezone: ORG_TZ, source: "manual" }]);
    onDone(code);
  };

  return (
    <Dialog
      title="Add shift code"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="add-shift">Add shift code</Button></>}
    >
      <form id="add-shift" className="form-grid" onSubmit={submit} noValidate>
        <Field label="Code" error={errors.code} hint="Shown on profiles and timesheets.">
          {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!errors.code} value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="OPS-D0730" />}
        </Field>
        <Field label="Name" error={errors.name}>
          {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!errors.name} value={f.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <div className="span-2">
          <fieldset className="segmented">
            <legend>Type</legend>
            {(["whole_day", "half_day"] as ShiftKind[]).map((k) => (
              <label key={k} className={f.kind === k ? "seg-on" : ""}>
                <input type="radio" name="kind" checked={f.kind === k} onChange={() => set("kind", k)} />
                {shiftKindLabel[k]} · {DEFAULT_SPAN[k].span / 60}h
              </label>
            ))}
          </fieldset>
        </div>
        <Field label="Start">
          {(id) => <input id={id} type="time" value={f.start} onChange={(e) => set("start", e.target.value)} />}
        </Field>
        <Field label="End" error={errors.end} hint={endTouched ? undefined : `Set ${expected / 60} hours after start. You can change it.`}>
          {(id, d) => <input id={id} type="time" aria-describedby={d} value={f.end} onChange={(e) => { setEndTouched(true); set("end", e.target.value); }} />}
        </Field>
        <Field label="Unpaid break (minutes)" error={errors.brk}>
          {(id, d) => <input id={id} type="number" min={0} max={240} step={15} aria-describedby={d} value={f.brk} onChange={(e) => set("brk", e.target.value)} />}
        </Field>
        <Field label="Grace period (minutes)" hint="Clock-ins within this window aren’t marked late.">
          {(id, d) => <input id={id} type="number" min={0} max={120} aria-describedby={d} value={f.grace} onChange={(e) => set("grace", e.target.value)} />}
        </Field>
        {span > 0 && (
          <p className={`span-2 ${span !== expected ? "text-warn" : "muted"}`}>
            {formatDuration(span)} on site, {formatDuration(Math.max(0, span - (Number(f.brk) || 0)))} paid
            {toMinutes(f.end) <= toMinutes(f.start) && ", ends the next day"}
            {span !== expected && `. That’s different from the ${expected / 60}-hour ${shiftKindLabel[f.kind].toLowerCase()} default, which is fine if intended.`}
          </p>
        )}
      </form>
    </Dialog>
  );
}

// ---- Bulk assign -------------------------------------------------------------

function AssignDialog({ shift, onClose, onDone }: { shift: ShiftCode; onClose: () => void; onDone: (n: number) => void }) {
  const db = useDb();
  const [q, setQ] = useState("");
  const people = db.employees.filter((e) => e.status === "active" || e.status === "onboarding" || e.status === "on_leave");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(people.filter((e) => e.shift_code_id === shift.id).map((e) => e.id)));
  const codeOf = (id: string | null) => db.shift_codes.find((s) => s.id === id)?.code;
  const list = people
    .filter((e) => `${displayName(e)} ${e.job_title}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(!!a.shift_code_id) - Number(!!b.shift_code_id) || displayName(a).localeCompare(displayName(b)));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const changed = people.filter((e) => picked.has(e.id) !== (e.shift_code_id === shift.id));

  return (
    <Dialog
      title={`Assign ${shift.code}`}
      description={`${shiftHours(shift)}. People without a shift code are listed first.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!changed.length} onClick={() => {
            assignShift(changed.filter((e) => picked.has(e.id)).map((e) => e.id), shift.id);
            assignShift(changed.filter((e) => !picked.has(e.id)).map((e) => e.id), null);
            onDone(picked.size);
          }}>
            Save {changed.length ? `${changed.length} ${changed.length === 1 ? "change" : "changes"}` : ""}
          </Button>
        </>
      }
    >
      <div className="stack-md">
        <SearchInput value={q} onChange={setQ} label="Search people" placeholder="Search people" />
        <ul className="pick-list">
          {list.map((e) => {
            const current = codeOf(e.shift_code_id);
            return (
              <li key={e.id}>
                <label className="pick">
                  <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                  <span className="box" aria-hidden="true"><Icon name="check" size={14} /></span>
                  <PersonCell person={e} sub={e.job_title} />
                  <span className={`pick-meta ${current ? "muted" : "text-warn"}`}>{current ?? "No shift code"}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
