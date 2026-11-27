"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCurrentUser, useDb } from "@/lib/store";
import { displayName, formatDate } from "@/lib/format";
import { formatDuration, formatInstant, summarizeDay, zoned, type DaySummary } from "@/lib/time";
import type { Employee, ShiftCode } from "@/lib/types";
import { Dialog, EmptyState, Button, PersonCell } from "@/components/ui";
import { DayStatusBadge, ProofPhoto, ShiftSummary, formatCoords, mapsUrl, useNow } from "./shared";

type Filter = "all" | "late" | "missing" | "no_out";
interface Row { e: Employee; shift: ShiftCode | undefined; s: DaySummary }

export function AttendanceView() {
  const db = useDb();
  const { canManage } = useCurrentUser();
  const now = useNow();
  const nowIso = new Date(now).toISOString();
  const today = zoned(now).date;

  const dates = useMemo(() => {
    const set = new Set(db.time_records.map((r) => r.work_date));
    set.add(today);
    return Array.from(set).sort().slice(-5);
  }, [db.time_records, today]);

  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Row | null>(null);

  const rows: Row[] = useMemo(() => {
    const recs = db.time_records.filter((r) => r.work_date === date);
    return db.employees
      .filter((e) => e.status !== "offboarded" && e.start_date <= date && (e.shift_code_id || recs.some((r) => r.employee_id === e.id)))
      .map((e) => {
        const shift = db.shift_codes.find((s) => s.id === e.shift_code_id);
        return { e, shift, s: summarizeDay(recs.filter((r) => r.employee_id === e.id), shift, date, nowIso, e.status === "on_leave") };
      })
      .sort((a, b) => rank(a.s) - rank(b.s) || displayName(a.e).localeCompare(displayName(b.e)));
  }, [db, date, nowIso]);

  if (!canManage) {
    return <div className="page"><EmptyState title="Only admins and HR can see team attendance" body="Your own records are on the My time page." action={<Link href="/my-time" className="btn btn-secondary btn-md">Go to My time</Link>} /></div>;
  }

  const late = rows.filter((r) => r.s.lateMinutes > 0);
  const missing = rows.filter((r) => r.s.status === "absent" || r.s.status === "not_in");
  const noOut = rows.filter((r) => r.s.status === "missing_out");
  const present = rows.filter((r) => r.s.clockIn);
  const scheduled = rows.filter((r) => !["rest_day", "on_leave", "no_shift"].includes(r.s.status));
  const untracked = db.employees.filter((e) => !e.shift_code_id && (e.status === "active" || e.status === "onboarding")).length;

  const shown = filter === "late" ? late : filter === "missing" ? missing : filter === "no_out" ? noOut : rows;
  const dayLabel = (d: string) => d === today ? "Today" : new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Attendance</h1>
          <p className="muted">
            {present.length} of {scheduled.length} scheduled people timed in {date === today ? "today" : `on ${formatDate(date)}`}
            {untracked > 0 && <> · <Link href="/time/shift-codes" className="link">{untracked} without a shift code</Link></>}
          </p>
        </div>
      </header>

      <div className="toolbar toolbar-split">
        <div className="segmented-tabs" role="tablist" aria-label="Day">
          {dates.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={date === d} className={date === d ? "st st-on" : "st"} onClick={() => { setDate(d); setFilter("all"); }}>
              {dayLabel(d)}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Show">
          {([
            ["all", "Everyone", rows.length],
            ["late", "Late", late.length],
            ["missing", "Not timed in", missing.length],
            ["no_out", "No time out", noOut.length],
          ] as [Filter, string, number][]).map(([k, label, n]) => (
            <button key={k} type="button" className={`chip ${filter === k ? "chip-on" : ""} ${k !== "all" && n > 0 ? "chip-alert" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)} disabled={k !== "all" && n === 0}>
              {label} <span className="num">{n}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Nothing to review" body="No one matches this filter for the selected day." action={<Button onClick={() => setFilter("all")}>Show everyone</Button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="col-lg">Shift</th>
                <th className="num">In</th>
                <th className="num col-md">Out</th>
                <th className="num col-lg">Worked</th>
                <th>Status</th>
                <th className="col-md">Proof</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const tz = r.shift?.timezone;
                return (
                  <tr key={r.e.id} className={r.s.clockIn ? "row-link" : ""} onClick={() => r.s.clockIn && setOpen(r)}>
                    <td>
                      {r.s.clockIn
                        ? <button type="button" className="row-anchor row-btn" onClick={(ev) => { ev.stopPropagation(); setOpen(r); }}><PersonCell person={r.e} sub={r.e.job_title} /></button>
                        : <PersonCell person={r.e} sub={r.e.job_title} />}
                    </td>
                    <td className="col-lg"><ShiftSummary shift={r.shift} /></td>
                    <td className="num">{r.s.clockIn ? formatInstant(r.s.clockIn.recorded_at, tz) : "—"}</td>
                    <td className="num col-md">{r.s.clockOut ? formatInstant(r.s.clockOut.recorded_at, tz) : "—"}</td>
                    <td className="num col-lg">{r.s.workedMinutes ? formatDuration(r.s.workedMinutes) : "—"}</td>
                    <td><DayStatusBadge s={r.s} /></td>
                    <td className="col-md">
                      <span className="proof-thumbs">
                        {r.s.records.slice(0, 2).map((rec) => <ProofPhoto key={rec.id} path={rec.photo_path} size={28} alt={`${displayName(r.e)} ${rec.kind === "clock_in" ? "time in" : "time out"} photo`} />)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <RecordDetail row={open} date={date} onClose={() => setOpen(null)} />}
    </div>
  );
}

function rank(s: DaySummary) {
  if (s.status === "missing_out" || s.status === "absent") return 0;
  if (s.status === "not_in" || s.lateMinutes > 0) return 1;
  if (s.status === "working" || s.status === "done") return 2;
  return 3;
}

function RecordDetail({ row, date, onClose }: { row: Row; date: string; onClose: () => void }) {
  const tz = row.shift?.timezone;
  return (
    <Dialog
      title={displayName(row.e)}
      description={`${formatDate(date)}${row.shift ? ` · ${row.shift.code}` : ""}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="record-grid">
        {row.s.records.map((r) => (
          <figure key={r.id} className="record">
            <ProofPhoto path={r.photo_path} size={200} alt={`Photo taken at ${r.kind === "clock_in" ? "time in" : "time out"}`} />
            <figcaption>
              <strong>Time {r.kind === "clock_in" ? "in" : "out"} · <span className="num">{formatInstant(r.recorded_at, tz)}</span></strong>
              <a className="link num" href={mapsUrl(r.latitude, r.longitude)} target="_blank" rel="noreferrer">{formatCoords(r.latitude, r.longitude)}</a>
              <span className="muted">Accurate to {r.accuracy_m} m{r.device && ` · ${r.device}`}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      {(row.s.lateMinutes > 0 || row.s.undertimeMinutes > 0) && (
        <p className="text-warn detail-note">
          {row.s.lateMinutes > 0 && `Timed in ${formatDuration(row.s.lateMinutes)} after the shift started. `}
          {row.s.undertimeMinutes > 0 && `Timed out ${formatDuration(row.s.undertimeMinutes)} before the shift ended.`}
        </p>
      )}
    </Dialog>
  );
}
