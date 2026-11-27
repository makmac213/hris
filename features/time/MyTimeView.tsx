"use client";

import { useState } from "react";
import { today as todayIso, useCurrentUser, useDb, workDateFor } from "@/lib/store";
import { cellFor, datesFrom, scheduleFor } from "@/lib/schedule";
import { formatDate } from "@/lib/format";
import { formatDuration, formatInstant, shiftHours, shiftKindLabel, summarizeDay } from "@/lib/time";
import type { TimeRecord } from "@/lib/types";
import { Button, EmptyState, Icon, Blank } from "@/components/ui";
import { DayStatusBadge, ProofPhoto, RecordWhere, paidMinutes, useNow } from "./shared";
import { RecordTimeDialog } from "./RecordTimeDialog";
import { CorrectionDialog, OvertimeDialog } from "@/features/requests/RequestDialogs";
import { MyRequests } from "@/features/requests/MyRequests";
import type { CorrectionKind } from "@/lib/types";

export function MyTimeView() {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const now = useNow(true);
  const nowIso = new Date(now).toISOString();
  const [recording, setRecording] = useState<TimeRecord["kind"] | null>(null);
  const [justRecorded, setJustRecorded] = useState<TimeRecord | null>(null);
  const [filing, setFiling] = useState<null | { type: "ot"; date?: string } | { type: "fix"; date?: string; kind?: CorrectionKind }>(null);
  const [filedNote, setFiledNote] = useState("");

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
  // The schedule decides today's shift and rest day; without one, the default shift on weekdays.
  const dayOf = (d: string) => { const sc = scheduleFor(db, me, d); return { shift: sc.shift ?? shift, rest: sc.source === "scheduled" ? sc.rest : undefined }; };
  const todayShift = dayOf(workDate);
  const today = summarizeDay(todays, todayShift.shift, workDate, nowIso, false, todayShift.rest);
  const upcoming = datesFrom(workDate, 7).map((d) => cellFor(db, me, d, todayIso()));
  const nextKind: TimeRecord["kind"] | null = !today.clockIn ? "clock_in" : !today.clockOut ? "clock_out" : null;

  const pastDates = Array.from(new Set(mine.map((r) => r.work_date))).filter((d) => d !== workDate).sort().reverse().slice(0, 6);
  const history = pastDates.map((d) => { const x = dayOf(d); return { date: d, s: summarizeDay(mine.filter((r) => r.work_date === d), x.shift, d, nowIso, false, x.rest) }; });

  const headline = (() => {
    if (today.status === "rest_day") return "Rest day. No shift today.";
    if (today.status === "upcoming") return `Your shift starts at ${shiftHours(todayShift.shift ?? shift).split(" – ")[0]}.`;
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

      {filedNote && (
        <div className="toast" role="status">
          <Icon name="check" size={18} /><span>{filedNote}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setFiledNote("")}><Icon name="x" size={16} /></button>
        </div>
      )}
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
                      <RecordWhere r={r} className="muted small-link" />
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
        <h2>Your next 7 days</h2>
        <ol className="upcoming">
          {upcoming.map((c) => {
            const lv = c.leave;
            const onLeave = lv?.status === "approved" && !lv.request.half_day;
            return (
              <li key={c.date}>
                <span className="today-label">{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${c.date}T00:00:00Z`))}</span>
                <span className={`sc ${onLeave ? "sc-leave" : c.sched.working ? (c.sched.source === "scheduled" ? "sc-shift" : "sc-default") : "sc-rest"} ${lv?.status === "pending" ? "sc-pending" : ""}`}>
                  <span className="sc-main num">{onLeave ? lv.type?.name ?? "Leave" : c.sched.working && c.sched.shift ? `${c.sched.shift.start_time}–${c.sched.shift.end_time}` : "Rest day"}</span>
                  <span className="sc-sub">{lv?.status === "pending" ? "Leave pending" : !onLeave && c.sched.working && c.sched.shift ? c.sched.shift.code : ""}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="muted small detail-note">Operations sets your schedule. Days they haven’t scheduled follow your usual shift.</p>
      </section>

      <section className="section">
        <h2>Recent days</h2>
        {history.length === 0 ? <p className="muted">Your past records will show here.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th className="num">In</th><th className="num">Out</th><th className="num col-md">Worked</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {history.map(({ date, s }) => (
                  <tr key={date}>
                    <td className="num">{formatDate(date)}</td>
                    <td className="num">{s.clockIn ? formatInstant(s.clockIn.recorded_at, shift.timezone) : <Blank />}</td>
                    <td className="num">{s.clockOut ? formatInstant(s.clockOut.recorded_at, shift.timezone) : <Blank />}</td>
                    <td className="num col-md">{s.workedMinutes ? formatDuration(s.workedMinutes) : <Blank />}</td>
                    <td><DayStatusBadge s={s} /></td>
                    <td className="actions-cell">
                      <Button size="sm" variant="ghost" onClick={() => setFiling({ type: "fix", date, kind: !s.clockOut ? "missing_out" : s.lateMinutes ? "wrong_in" : "wrong_out" })}>Request a fix</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>My requests</h2>
          <div className="head-actions">
            <Button size="sm" onClick={() => setFiling({ type: "fix" })}>Request a time correction</Button>
            <Button size="sm" onClick={() => setFiling({ type: "ot" })}>File overtime</Button>
          </div>
        </div>
        <MyRequests employeeId={me.id} shift={shift} />
      </section>

      {filing?.type === "ot" && (
        <OvertimeDialog
          employee={me}
          shift={shift}
          managerial={!!db.compensation.find((c) => c.employee_id === me.id)?.is_managerial}
          initialDate={filing.date}
          onClose={() => setFiling(null)}
          onDone={() => { setFiling(null); setFiledNote("Overtime request sent for approval."); }}
        />
      )}
      {filing?.type === "fix" && (
        <CorrectionDialog
          employee={me}
          shift={shift}
          initialDate={filing.date}
          initialKind={filing.kind}
          onClose={() => setFiling(null)}
          onDone={() => { setFiling(null); setFiledNote("Correction request sent for approval."); }}
        />
      )}

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
