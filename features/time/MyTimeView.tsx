"use client";

import { useState } from "react";
import { useCurrentUser, useDb, workDateFor } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { formatDuration, formatInstant, shiftHours, shiftKindLabel, summarizeDay } from "@/lib/time";
import type { TimeRecord } from "@/lib/types";
import { Button, EmptyState, Icon } from "@/components/ui";
import { DayStatusBadge, ProofPhoto, formatCoords, mapsUrl, paidMinutes, useNow } from "./shared";
import { RecordTimeDialog } from "./RecordTimeDialog";

export function MyTimeView() {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const now = useNow(true);
  const nowIso = new Date(now).toISOString();
  const [recording, setRecording] = useState<TimeRecord["kind"] | null>(null);
  const [justRecorded, setJustRecorded] = useState<TimeRecord | null>(null);

  const shift = db.shift_codes.find((s) => s.id === me.shift_code_id);
  if (!shift) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>My time</h1></div></header>
        <EmptyState
          title="You don’t have a shift code yet"
          body="HR assigns your shift. Once it’s set, you can record your time in and out here."
        />
      </div>
    );
  }

  const workDate = workDateFor(me, nowIso);
  const mine = db.time_records.filter((r) => r.employee_id === me.id);
  const todays = mine.filter((r) => r.work_date === workDate);
  const today = summarizeDay(todays, shift, workDate, nowIso);
  const nextKind: TimeRecord["kind"] | null = !today.clockIn ? "clock_in" : !today.clockOut ? "clock_out" : null;

  const pastDates = Array.from(new Set(mine.map((r) => r.work_date))).filter((d) => d !== workDate).sort().reverse().slice(0, 6);
  const history = pastDates.map((d) => ({ date: d, s: summarizeDay(mine.filter((r) => r.work_date === d), shift, d, nowIso) }));

  const headline = (() => {
    if (today.status === "rest_day") return "Rest day. No shift today.";
    if (today.status === "upcoming") return `Your shift starts at ${shiftHours(shift).split(" – ")[0]}.`;
    if (today.status === "not_in") return "You haven’t recorded your time in yet.";
    if (today.status === "working") return `Timed in at ${formatInstant(today.clockIn!.recorded_at, shift.timezone)}${today.lateMinutes ? `, ${formatDuration(today.lateMinutes)} late` : ""}.`;
    if (today.status === "missing_out") return "You didn’t record your time out. Record it now or tell HR.";
    if (today.status === "done") return `Done for today. ${formatDuration(today.workedMinutes)} worked${today.undertimeMinutes ? `, timed out ${formatDuration(today.undertimeMinutes)} early` : ""}.`;
    return "";
  })();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>My time</h1>
          <p className="muted"><span className="code">{shift.code}</span> · {shiftHours(shift)} · {shiftKindLabel[shift.kind]}, {formatDuration(paidMinutes(shift))} paid</p>
        </div>
      </header>

      {justRecorded && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          <span>Time {justRecorded.kind === "clock_in" ? "in" : "out"} recorded at {formatInstant(justRecorded.recorded_at, shift.timezone)}.</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setJustRecorded(null)}><Icon name="x" size={16} /></button>
        </div>
      )}

      <section className="clock-card" aria-label="Today">
        <div className="clock-main">
          <p className="clock-date" suppressHydrationWarning>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: shift.timezone }).format(now)}</p>
          <p className="clock-time num" aria-live="off" suppressHydrationWarning>
            {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: shift.timezone }).format(now)}
          </p>
          <p className="clock-status">{headline}</p>
          {nextKind && today.status !== "rest_day" ? (
            <Button variant="primary" icon="camera" className="btn-lg" onClick={() => setRecording(nextKind)}>
              Record time {nextKind === "clock_in" ? "in" : "out"}
            </Button>
          ) : null}
          <p className="clock-note muted">Recording takes your photo and location. Both are required.</p>
        </div>
        <ol className="today-list" aria-label="Today’s records">
          {(["clock_in", "clock_out"] as const).map((k) => {
            const r = k === "clock_in" ? today.clockIn : today.clockOut;
            return (
              <li key={k} className={r ? "" : "today-empty"}>
                {r ? <ProofPhoto path={r.photo_path} size={48} alt={`Photo taken at time ${k === "clock_in" ? "in" : "out"}`} /> : <span className="photo-slot" aria-hidden="true" />}
                <span className="cell-2">
                  <span className="today-label">Time {k === "clock_in" ? "in" : "out"}</span>
                  {r ? (
                    <>
                      <strong className="num">{formatInstant(r.recorded_at, shift.timezone)}</strong>
                      <a className="muted small-link" href={mapsUrl(r.latitude, r.longitude)} target="_blank" rel="noreferrer">{formatCoords(r.latitude, r.longitude)}</a>
                    </>
                  ) : <span className="muted">Not recorded</span>}
                </span>
              </li>
            );
          })}
          {today.clockIn && (
            <li className="today-total">
              <span className="today-label">Worked {today.clockOut ? "" : "so far"}</span>
              <strong className="num">{formatDuration(today.workedMinutes)}</strong>
            </li>
          )}
        </ol>
      </section>

      <section className="section">
        <h2>Recent days</h2>
        {history.length === 0 ? <p className="muted">Your past records will show here.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th className="num">In</th><th className="num">Out</th><th className="num col-md">Worked</th><th>Status</th></tr></thead>
              <tbody>
                {history.map(({ date, s }) => (
                  <tr key={date}>
                    <td className="num">{formatDate(date)}</td>
                    <td className="num">{s.clockIn ? formatInstant(s.clockIn.recorded_at, shift.timezone) : "—"}</td>
                    <td className="num">{s.clockOut ? formatInstant(s.clockOut.recorded_at, shift.timezone) : "—"}</td>
                    <td className="num col-md">{s.workedMinutes ? formatDuration(s.workedMinutes) : "—"}</td>
                    <td><DayStatusBadge s={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {recording && (
        <RecordTimeDialog
          employee={me}
          shift={shift}
          kind={recording}
          workDate={workDate}
          onClose={() => setRecording(null)}
          onDone={(r) => { setRecording(null); setJustRecorded(r); }}
        />
      )}
    </div>
  );
}
