"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { assignSchedule, directReports, resetSchedule, today, updateScheduleSettings, useCurrentUser, useDb } from "@/lib/store";
import { addDays, displayName, formatDate, formatShortDate } from "@/lib/format";
import { cellFor, coverCandidates, coverageGaps, datesFrom, HORIZON_LIMITS, scheduledPeople, scheduleFor, scheduleWindow, type ScheduleCell } from "@/lib/schedule";
import { shiftHours } from "@/lib/time";
import type { Database, Employee, ShiftCode } from "@/lib/types";
import { Button, Dialog, EmptyState, Field, FilterSelect, Icon, SearchInput } from "@/components/ui";

const key = (employeeId: string, date: string) => `${employeeId}|${date}`;
const split = (k: string) => { const [employee_id, work_date] = k.split("|"); return { employee_id, work_date }; };
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dayNum = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });
const leaveAbbr = (name: string | undefined) => (name ?? "Leave").split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3);
const hm = (s: ShiftCode) => `${s.start_time}–${s.end_time}`;

export function ScheduleView() {
  const db = useDb();
  const { employee: me, canSchedule } = useCurrentUser();
  const params = useSearchParams();
  const now = today();
  const reports = useMemo(() => directReports(db, me.id), [db, me.id]);
  const isManager = reports.length > 0;

  const [start, setStart] = useState(() => mondayOf(now));
  const [span, setSpan] = useState<7 | 14>(14);
  const [dept, setDept] = useState<string>(me.role === "operations" && me.department_id ? me.department_id : "");
  const [branch, setBranch] = useState("");
  const [client, setClient] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<{ text: string; tone: "ok" | "warn" | "danger" } | null>(null);
  const [cover, setCover] = useState<{ employee: Employee; cell: ScheduleCell } | null>(null);
  const [settings, setSettings] = useState(false);

  // A notification links to /schedule?date=…: open the week that has it.
  const linked = params?.get("date");
  useEffect(() => { if (linked && /^\d{4}-\d{2}-\d{2}$/.test(linked)) setStart(mondayOf(linked)); }, [linked]);

  const dates = datesFrom(start, span);
  const end = dates[dates.length - 1];
  const win = scheduleWindow(db, now);
  const people = useMemo(() => {
    const all = scheduledPeople(db, start, end, { department_id: dept, location_id: branch, client_id: client, q });
    return canSchedule ? all : all.filter((e) => reports.some((r) => r.id === e.id));
  }, [db, start, end, dept, branch, client, q, canSchedule, reports]);
  const byId = useMemo(() => new Map(db.employees.map((e) => [e.id, e])), [db.employees]);
  const grid = useMemo(() => people.map((e) => ({ e, cells: dates.map((d) => cellFor(db, e, d, now, byId)) })), [people, dates.join(), db, now, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const gaps = useMemo(() => coverageGaps(db, people, dates, now), [db, people, dates.join(), now]); // eslint-disable-line react-hooks/exhaustive-deps
  const openGaps = gaps.filter((g) => !g.cell.coveredBy);
  const pendingOnShift = grid.flatMap(({ e, cells }) => cells.filter((c) => c.leave?.status === "pending" && c.sched.working && c.sched.source === "scheduled" && c.date >= now).map((c) => ({ e, c })));

  if (!canSchedule && !isManager) {
    return <div className="page"><EmptyState title="The schedule is for operations and managers" body="Your own shifts are on the My time page." action={<Link href="/my-time" className="btn btn-secondary btn-md">Go to My time</Link>} /></div>;
  }

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const selectMany = (keys: string[]) => setSelected((s) => {
    const n = new Set(s);
    const all = keys.every((k) => n.has(k));
    for (const k of keys) if (all) n.delete(k); else n.add(k);
    return n;
  });
  const editableKeys = (pred: (e: Employee, c: ScheduleCell) => boolean) => grid.flatMap(({ e, cells }) => cells.filter((c) => c.editable && pred(e, c)).map((c) => key(e.id, c.date)));

  const apply = (shiftId: string | null) => {
    const entries = [...selected].map((k) => ({ ...split(k), shift_code_id: shiftId }));
    const res = assignSchedule(entries, me.id);
    const errs = Object.entries(res.errors);
    if (errs.length) {
      const [k, msg] = errs[0];
      const e = byId.get(k.split(":")[0]);
      setNote({ tone: "danger", text: `Nothing was saved. ${e ? `${displayName(e)}, ${formatShortDate(k.split(":")[1])}: ` : ""}${msg}${errs.length > 1 ? ` (${errs.length - 1} more like this)` : ""}` });
      return;
    }
    const warns = Object.values(res.warnings);
    setSelected(new Set());
    setNote(warns.length
      ? { tone: "warn", text: `${res.saved} ${res.saved === 1 ? "day" : "days"} scheduled. ${warns.length === 1 ? warns[0] : `${warns.length} of them have leave pending. If it’s approved, you’ll be notified.`}` }
      : { tone: "ok", text: `${res.saved} ${res.saved === 1 ? "day" : "days"} scheduled.` });
  };
  const reset = () => {
    const n = resetSchedule([...selected].map(split));
    setSelected(new Set());
    setNote({ tone: "ok", text: `${n} ${n === 1 ? "day" : "days"} back on the default shift.` });
  };
  const onLocked = (e: Employee, c: ScheduleCell) => setNote({ tone: "warn", text: c.lockReason ?? `${displayName(e)} can’t be scheduled on ${formatShortDate(c.date)}.` });

  const depts = [...db.departments].sort((a, b) => a.name.localeCompare(b.name));
  const branches = db.locations;
  const clients = db.clients.filter((c) => !c.archived_at);
  const holidayOn = (d: string) => db.holidays.find((h) => h.date === d && h.kind !== "special_working");

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1>Schedule</h1>
          <p className="muted">
            {canSchedule
              ? <>You can schedule from today through {formatDate(win.last)}. Days you haven’t scheduled follow each person’s default shift.</>
              : <>Your team’s shifts. Operations schedules them.</>}
          </p>
        </div>
        {canSchedule && <Button icon="settings" onClick={() => setSettings(true)}>Scheduling rules</Button>}
      </header>

      {note && (
        <div className={`toast toast-${note.tone}`} role="status">
          <Icon name={note.tone === "ok" ? "check" : "alert"} size={18} /><span>{note.text}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNote(null)}><Icon name="x" size={16} /></button>
        </div>
      )}

      {(gaps.length > 0 || pendingOnShift.length > 0) && (
        <section className="sched-attn" aria-label="Needs attention">
          {gaps.length > 0 && (
            <div className="sched-attn-group">
              <h2>{openGaps.length ? `${openGaps.length} ${openGaps.length === 1 ? "shift needs" : "shifts need"} cover` : "All leave gaps are covered"}</h2>
              <ul>
                {gaps.map(({ employee: e, cell: c }) => (
                  <li key={key(e.id, c.date)} className="sched-attn-row">
                    <span className={`dot ${c.coveredBy ? "dot-ok" : "dot-danger"}`} aria-hidden="true" />
                    <span className="sched-attn-text">
                      <strong>{displayName(e)}</strong>, {formatShortDate(c.date)}{c.sched.shift && <> · <span className="num">{hm(c.sched.shift)}</span></>}
                      <span className="muted"> · {c.leave?.type?.name ?? "Leave"} approved{c.shortNotice ? ", short notice" : ""}</span>
                      {c.coveredBy && <span className="text-ok"> · Covered by {displayName(c.coveredBy)}</span>}
                    </span>
                    {canSchedule && !c.coveredBy && <Button size="sm" onClick={() => setCover({ employee: e, cell: c })}>Find cover</Button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pendingOnShift.length > 0 && (
            <div className="sched-attn-group">
              <h2>{pendingOnShift.length} scheduled {pendingOnShift.length === 1 ? "day has" : "days have"} leave pending</h2>
              <ul>
                {pendingOnShift.map(({ e, c }) => (
                  <li key={key(e.id, c.date)} className="sched-attn-row">
                    <span className="dot dot-warn" aria-hidden="true" />
                    <span className="sched-attn-text">
                      <strong>{displayName(e)}</strong>, {formatShortDate(c.date)}
                      <span className="muted"> · {c.leave?.type?.name ?? "Leave"} pending{c.shortNotice ? ", short notice" : ""}. You’ll be notified if it’s approved.</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="toolbar toolbar-split">
        <div className="sched-nav">
          <button type="button" className="icon-btn" aria-label="Earlier" onClick={() => setStart(addDays(start, -7))}><Icon name="chevronLeft" /></button>
          <Button size="sm" variant="ghost" onClick={() => setStart(mondayOf(now))}>This week</Button>
          <button type="button" className="icon-btn" aria-label="Later" onClick={() => setStart(addDays(start, 7))}><Icon name="chevronRight" /></button>
          <span className="sched-range">{formatShortDate(start)} – {formatDate(end)}</span>
          <div className="segmented-tabs" role="tablist" aria-label="Range">
            {([7, 14] as const).map((n) => <button key={n} type="button" role="tab" aria-selected={span === n} className={span === n ? "st st-on" : "st"} onClick={() => setSpan(n)}>{n === 7 ? "1 week" : "2 weeks"}</button>)}
          </div>
        </div>
        <div className="filters sched-filters">
          <SearchInput value={q} onChange={setQ} label="Search people" placeholder="Search people" />
          {depts.length > 1 && <FilterSelect label="Departments" value={dept} onChange={setDept} options={depts.map((d) => ({ value: d.id, label: d.name }))} />}
          {branches.length > 1 && <FilterSelect label="Branches" value={branch} onChange={setBranch} options={branches.map((l) => ({ value: l.id, label: l.name }))} />}
          {clients.length > 0 && <FilterSelect label="Clients" value={client} onChange={setClient} options={clients.map((c) => ({ value: c.id, label: c.name }))} />}
        </div>
      </div>

      {people.length === 0 ? (
        <EmptyState title="No one matches" body="Nobody in these filters works during these dates." action={<Button onClick={() => { setDept(""); setBranch(""); setClient(""); setQ(""); }}>Clear filters</Button>} />
      ) : (
        <div className="sched-wrap">
          <table className="sched">
            <thead>
              <tr>
                <th scope="col" className="sched-person">{people.length} {people.length === 1 ? "person" : "people"}</th>
                {dates.map((d) => {
                  const h = holidayOn(d);
                  const cls = ["sched-day", d === now ? "sched-today" : "", d < now || d > win.last ? "sched-off" : ""].join(" ");
                  const body = <><span className="sched-wd">{weekday.format(new Date(`${d}T00:00:00Z`))}</span><span className="sched-dn">{dayNum.format(new Date(`${d}T00:00:00Z`))}</span>{h && <span className="sched-hol" title={h.name}>Holiday</span>}</>;
                  return (
                    <th key={d} scope="col" className={cls} aria-label={`${formatDate(d)}${h ? `, ${h.name}` : ""}`}>
                      {canSchedule && d >= now && d <= win.last
                        ? <button type="button" className="sched-colbtn" onClick={() => selectMany(editableKeys((_, c) => c.date === d))} title="Select this day for everyone shown">{body}</button>
                        : body}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grid.map(({ e, cells }) => {
                const client = db.clients.find((c) => c.id === e.client_id);
                const branchName = db.locations.find((l) => l.id === e.location_id)?.name;
                const who = <><span className="person-name">{displayName(e)}</span><span className="person-sub">{[client?.code, branchName, e.job_title].filter(Boolean).join(" · ")}</span></>;
                return (
                  <tr key={e.id}>
                    <th scope="row" className="sched-person">
                      {canSchedule
                        ? <button type="button" className="sched-rowbtn" onClick={() => selectMany(editableKeys((p) => p.id === e.id))} title="Select this person’s days">{who}</button>
                        : <span className="sched-rowbtn">{who}</span>}
                    </th>
                    {cells.map((c) => <Cell key={c.date} db={db} e={e} c={c} interactive={canSchedule} selected={selected.has(key(e.id, c.date))} onToggle={() => toggle(key(e.id, c.date))} onLocked={() => onLocked(e, c)} onCover={() => setCover({ employee: e, cell: c })} />)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ul className="sched-legend" aria-label="Legend">
        <li><span className="swatch sw-shift" /> Scheduled shift</li>
        <li><span className="swatch sw-default" /> Default shift (not scheduled yet)</li>
        <li><span className="swatch sw-rest" /> Rest day</li>
        <li><span className="swatch sw-leave" /> On approved leave</li>
        <li><span className="swatch sw-pending" /> Leave pending</li>
        <li><span className="swatch sw-gap" /> Needs cover</li>
      </ul>

      {canSchedule && selected.size > 0 && <ActionBar db={db} count={selected.size} onApply={apply} onReset={reset} onClear={() => setSelected(new Set())} />}
      {cover && <CoverDialog gap={cover} onClose={() => setCover(null)} onDone={(t) => { setCover(null); setNote({ tone: "ok", text: t }); }} />}
      {settings && <SettingsDialog onClose={() => setSettings(false)} onDone={(t) => { setSettings(false); setNote({ tone: "ok", text: t }); }} />}
    </div>
  );
}

// ---- One day for one person ---------------------------------------------------------

function Cell({ db, e, c, interactive, selected, onToggle, onLocked, onCover }: { db: Database; e: Employee; c: ScheduleCell; interactive: boolean; selected: boolean; onToggle: () => void; onLocked: () => void; onCover: () => void }) {
  const s = c.sched;
  const lv = c.leave;
  const tone = c.gap ? (c.coveredBy ? "covered" : "gap") : lv?.status === "approved" && !lv.request.half_day ? "leave" : s.working ? (s.source === "scheduled" ? "shift" : "default") : "rest";
  const main = tone === "gap" || tone === "covered" || tone === "leave"
    ? leaveAbbr(lv?.type?.name)
    : s.working && s.shift ? hm(s.shift) : "Rest";
  const sub = tone === "gap" ? "Needs cover"
    : tone === "covered" ? `Cover: ${c.coveredBy ? displayName(c.coveredBy).split(" ")[0] : ""}`
    : tone === "leave" ? "On leave"
    : lv?.status === "pending" ? `${leaveAbbr(lv.type?.name)} pending`
    : lv?.request.half_day ? `½ ${leaveAbbr(lv.type?.name)}`
    : s.working && s.shift ? s.shift.code : "";
  const label = [
    displayName(e), formatDate(c.date),
    tone === "gap" ? `on approved ${lv?.type?.name.toLowerCase()}, shift ${s.shift ? hm(s.shift) : ""} needs cover`
      : tone === "covered" ? `on approved ${lv?.type?.name.toLowerCase()}, covered by ${c.coveredBy ? displayName(c.coveredBy) : ""}`
      : tone === "leave" ? `on approved ${lv?.type?.name.toLowerCase()}`
      : s.working && s.shift ? `${s.source === "default" ? "default shift" : "scheduled"} ${s.shift.code}, ${shiftHours(s.shift)}` : "rest day",
    lv?.status === "pending" ? `${lv.type?.name ?? "leave"} pending` : "",
    c.shortNotice && lv ? "short notice" : "",
  ].filter(Boolean).join(", ");
  const flagged = c.shortNotice && !!lv;
  const cls = `sc sc-${tone} ${lv?.status === "pending" ? "sc-pending" : ""} ${selected ? "sc-sel" : ""} ${!c.editable ? "sc-locked" : ""} ${c.date < today() ? "sc-past" : ""} ${flagged ? "sc-flagged" : ""}`;
  const inner = <><span className="sc-main num">{main}</span>{sub && <span className="sc-sub">{sub}</span>}{flagged && <span className="sc-flag" aria-hidden="true">!</span>}</>;
  void db;
  return (
    <td className="sched-cell">
      {interactive ? (
        <button type="button" className={cls} aria-pressed={c.editable ? selected : undefined} aria-label={label} title={c.lockReason ?? undefined}
          onClick={() => (tone === "gap" ? onCover() : c.editable ? onToggle() : onLocked())}>
          {inner}
        </button>
      ) : <span className={cls} aria-label={label} role="img">{inner}</span>}
    </td>
  );
}

// ---- Bulk actions -------------------------------------------------------------------

function ActionBar({ db, count, onApply, onReset, onClear }: { db: Database; count: number; onApply: (shiftId: string | null) => void; onReset: () => void; onClear: () => void }) {
  const codes = db.shift_codes.filter((s) => !s.archived_at);
  const [shift, setShift] = useState(codes.find((s) => s.is_default)?.id ?? codes[0]?.id ?? "");
  return (
    <div className="sched-bar" role="region" aria-label="Selected days">
      <strong className="num">{count} {count === 1 ? "day" : "days"} selected</strong>
      <label className="filter">
        <span className="sr-only">Shift</span>
        <select value={shift} onChange={(e) => setShift(e.target.value)}>
          {codes.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.start_time}–{s.end_time}</option>)}
        </select>
        <Icon name="chevronDown" size={16} />
      </label>
      <Button variant="primary" size="sm" onClick={() => onApply(shift)}>Assign shift</Button>
      <Button size="sm" onClick={() => onApply(null)}>Make rest day</Button>
      <Button size="sm" variant="ghost" onClick={onReset}>Use default</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear selection</Button>
    </div>
  );
}

// ---- Cover a gap ----------------------------------------------------------------------

function CoverDialog({ gap, onClose, onDone }: { gap: { employee: Employee; cell: ScheduleCell }; onClose: () => void; onDone: (msg: string) => void }) {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const { employee: e, cell: c } = gap;
  const candidates = coverCandidates(db, e, c.date, today());
  const [pick, setPick] = useState(candidates[0]?.id ?? "");
  const [err, setErr] = useState("");
  const shift = c.sched.shift;
  const save = () => {
    if (!pick || !shift) return;
    const res = assignSchedule([{ employee_id: pick, work_date: c.date, shift_code_id: shift.id, covers_employee_id: e.id }], me.id);
    const first = Object.values(res.errors)[0];
    if (first) return setErr(first);
    const p = db.employees.find((x) => x.id === pick)!;
    onDone(`${displayName(p)} covers ${displayName(e)} on ${formatShortDate(c.date)}, ${shift.code}.${Object.values(res.warnings)[0] ? ` ${Object.values(res.warnings)[0]}` : ""}`);
  };
  return (
    <Dialog title={`Cover ${displayName(e)}, ${formatShortDate(c.date)}`}
      description={`${c.leave?.type?.name ?? "Leave"} approved. ${shift ? `${shift.code}, ${shiftHours(shift)}.` : ""} People off that day in the same department or on the same client are listed, same client first.`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick} onClick={save}>Schedule cover</Button></>}>
      {candidates.length === 0 ? (
        <p className="muted">No one in {e.client_id ? "the account or " : ""}the department is free that day. Pick people from another team on the schedule instead.</p>
      ) : (
        <fieldset className="segmented-list">
          <legend className="sr-only">Who covers</legend>
          <ul className="pick-list">
            {candidates.map((p) => {
              const s = scheduleFor(db, p, c.date);
              const cl = db.clients.find((x) => x.id === p.client_id);
              return (
                <li key={p.id}>
                  <label className="pick">
                    <input type="radio" name="cover" checked={pick === p.id} onChange={() => { setPick(p.id); setErr(""); }} />
                    <span className="box box-radio" aria-hidden="true" />
                    <span className="person-text">
                      <span className="person-name">{displayName(p)}</span>
                      <span className="person-sub">{[cl?.code, db.locations.find((l) => l.id === p.location_id)?.name, p.job_title].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="pick-meta muted">{s.rest ? "Rest day" : "No shift"}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      {err && <p className="text-danger detail-note">{err}</p>}
      {candidates.length > 0 && <p className="muted small detail-note">Covering on a rest day is paid at the rest day rate (+30%, Labor Code Art. 93).</p>}
    </Dialog>
  );
}

// ---- Settings ---------------------------------------------------------------------------

function SettingsDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const db = useDb();
  const [horizon, setHorizon] = useState(String(db.schedule_settings.horizon_days));
  const [hours, setHours] = useState(String(db.schedule_settings.short_notice_hours));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const save = () => {
    const h = Number(horizon), n = Number(hours);
    const e: Record<string, string> = {};
    if (!Number.isInteger(h) || h < HORIZON_LIMITS.min || h > HORIZON_LIMITS.max) e.h = `A whole number from ${HORIZON_LIMITS.min} to ${HORIZON_LIMITS.max}.`;
    if (!Number.isInteger(n) || n < 1 || n > 168) e.n = "A whole number from 1 to 168.";
    if (Object.keys(e).length) return setErrs(e);
    updateScheduleSettings({ horizon_days: h, short_notice_hours: n });
    onDone(`Scheduling rules saved. You can schedule ${h} days ahead.`);
  };
  return (
    <Dialog title="Scheduling rules" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Schedule up to (days ahead)" hint={`Shifts can be assigned from today to this many days out. ${HORIZON_LIMITS.min}–${HORIZON_LIMITS.max}.`} error={errs.h}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={horizon} onChange={(ev) => setHorizon(ev.target.value)} />}
        </Field>
        <Field label="Short notice (hours)" hint="Leave filed less than this before the shift starts is flagged, and operations is told when it’s filed, not only when it’s approved." error={errs.n}>
          {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={hours} onChange={(ev) => setHours(ev.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
