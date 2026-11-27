"use client";

import Link from "next/link";
import { useState } from "react";
import { canApprove, decideRequest, isPeriodLocked, useCurrentUser, useDb } from "@/lib/store";
import { displayName, formatDate } from "@/lib/format";
import { formatDuration, formatInstant } from "@/lib/time";
import { effectiveInOut } from "@/lib/payroll";
import type { CorrectionRequest, Employee, OvertimeRequest } from "@/lib/types";
import { Button, EmptyState, Icon, PersonCell } from "@/components/ui";
import { ProofPhoto } from "@/features/time/shared";
import { RequestStatusBadge } from "./MyRequests";
import { correctionKindLabel } from "./RequestDialogs";

type Item =
  | { type: "overtime"; r: OvertimeRequest; e: Employee }
  | { type: "correction"; r: CorrectionRequest; e: Employee };

export function ApprovalsView() {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");

  const items: Item[] = [
    ...db.overtime_requests.map((r) => ({ type: "overtime" as const, r, e: db.employees.find((x) => x.id === r.employee_id)! })),
    ...db.correction_requests.map((r) => ({ type: "correction" as const, r, e: db.employees.find((x) => x.id === r.employee_id)! })),
  ].filter((it) => it.e && canApprove(db, me, it.e.id));

  const pending = items.filter((it) => it.r.status === "pending").sort((a, b) => a.r.filed_at.localeCompare(b.r.filed_at));
  const decided = items.filter((it) => it.r.status === "approved" || it.r.status === "rejected").sort((a, b) => (b.r.decided_at ?? "").localeCompare(a.r.decided_at ?? ""));
  const isApprover = me.role !== "employee" || db.employees.some((e) => e.manager_id === me.id);

  if (!isApprover) {
    return <div className="page"><EmptyState title="You don’t approve requests" body="Approvals go to each person’s manager, and to HR." action={<Link href="/my-time" className="btn btn-secondary btn-md">Go to My time</Link>} /></div>;
  }

  const decide = (it: Item, approve: boolean) => {
    decideRequest(it.type, it.r.id, me.id, approve, approve ? null : note.trim());
    setRejecting(null); setNote("");
    setDone(`${approve ? "Approved" : "Rejected"} ${displayName(it.e)}’s ${it.type === "overtime" ? "overtime" : "time correction"}.${approve && it.type === "correction" ? " The corrected time now counts for attendance and payroll." : ""}`);
  };

  const list = tab === "pending" ? pending : decided;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="muted">
            {me.role === "employee" ? "Requests from your direct reports." : "Requests from everyone. Managers can also approve for their own teams."}
            {" "}Overtime is paid only once approved.
          </p>
        </div>
      </header>

      {done && (
        <div className="toast" role="status">
          <Icon name="check" size={18} /><span>{done}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setDone("")}><Icon name="x" size={16} /></button>
        </div>
      )}

      <div className="segmented-tabs" role="tablist" aria-label="Requests">
        <button type="button" role="tab" aria-selected={tab === "pending"} className={tab === "pending" ? "st st-on" : "st"} onClick={() => setTab("pending")}>To review <span className="num">{pending.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "decided"} className={tab === "decided" ? "st st-on" : "st"} onClick={() => setTab("decided")}>Decided <span className="num">{decided.length}</span></button>
      </div>

      {list.length === 0 ? (
        <div className="section">
          <EmptyState title={tab === "pending" ? "You’re all caught up" : "Nothing decided yet"} body={tab === "pending" ? "New overtime and time correction requests from your people will show up here." : "Requests you approve or reject will be listed here."} />
        </div>
      ) : (
        <ul className="approvals">
          {list.map((it) => {
            const tz = db.shift_codes.find((s) => s.id === it.e.shift_code_id)?.timezone ?? "Asia/Manila";
            const recs = db.time_records.filter((r) => r.employee_id === it.e.id && r.work_date === it.r.work_date);
            const { clockIn, clockOut } = effectiveInOut(recs);
            const locked = isPeriodLocked(db, it.r.work_date);
            return (
              <li key={it.r.id} className="approval">
                <div className="approval-head">
                  <PersonCell person={it.e} sub={it.e.job_title} />
                  <span className="approval-kind">{it.type === "overtime" ? "Overtime" : "Time correction"} · {formatDate(it.r.work_date)}</span>
                </div>

                {it.type === "overtime" ? (
                  <OvertimeDetail r={it.r} tz={tz} clockIn={clockIn?.recorded_at} clockOut={clockOut?.recorded_at} />
                ) : (
                  <div className="approval-body">
                    <p className="approval-what">
                      <strong>{correctionKindLabel[it.r.kind]}</strong>: set to <strong className="num">{formatInstant(it.r.proposed_at, tz)}</strong>
                    </p>
                    <div className="evidence">
                      {(() => {
                        const orig = recs.find((r) => r.id === it.r.original_record_id);
                        return orig ? (
                          <span className="evidence-row"><ProofPhoto path={orig.photo_path} size={32} alt="Original record photo" /> On file: <span className="num">{formatInstant(orig.recorded_at, tz)}</span></span>
                        ) : <span className="evidence-row muted">No original record for this on file.</span>;
                      })()}
                    </div>
                  </div>
                )}
                <p className="approval-reason">“{it.r.reason}”</p>

                {it.r.status === "pending" ? (
                  rejecting === it.r.id ? (
                    <div className="reject-box">
                      <label htmlFor={`note-${it.r.id}`}>Reason for rejecting (sent to {it.e.preferred_name ?? it.e.first_name})</label>
                      <textarea id={`note-${it.r.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                      <div className="approval-actions">
                        <Button variant="ghost" onClick={() => { setRejecting(null); setNote(""); }}>Cancel</Button>
                        <Button variant="primary" className="btn-danger" disabled={note.trim().length < 5} onClick={() => decide(it, false)}>Reject request</Button>
                      </div>
                    </div>
                  ) : locked ? (
                    <p className="text-warn">Payroll for this date is finalized. Handle this as a payroll adjustment.</p>
                  ) : (
                    <div className="approval-actions">
                      <Button onClick={() => { setRejecting(it.r.id); setNote(""); }}>Reject</Button>
                      <Button variant="primary" icon="check" onClick={() => decide(it, true)}>Approve</Button>
                    </div>
                  )
                ) : (
                  <div className="approval-actions decided">
                    <RequestStatusBadge status={it.r.status} />
                    <span className="muted">{it.r.decision_note ?? ""}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OvertimeDetail({ r, tz, clockIn, clockOut }: { r: OvertimeRequest; tz: string; clockIn?: string; clockOut?: string }) {
  const mins = (Date.parse(r.end_at) - Date.parse(r.start_at)) / 60000;
  const covered = clockIn && clockOut ? Math.max(0, Math.min(Date.parse(clockOut), Date.parse(r.end_at)) - Math.max(Date.parse(clockIn), Date.parse(r.start_at))) / 60000 : 0;
  const future = Date.parse(r.start_at) > Date.now();
  return (
    <div className="approval-body">
      <p className="approval-what">
        <strong className="num">{formatInstant(r.start_at, tz)} to {formatInstant(r.end_at, tz)}</strong> · {formatDuration(mins)} requested
      </p>
      <p className={`evidence-row ${future ? "muted" : covered >= mins ? "ok-text" : "text-warn"}`}>
        {future
          ? "Filed in advance. Pay will follow the time records."
          : covered >= mins
            ? <><Icon name="check" size={16} /> Time records cover all of it ({clockOut && `out at ${formatInstant(clockOut, tz)}`})</>
            : covered > 0
              ? `Time records cover ${formatDuration(covered)}. Only that much would be paid.`
              : "No time records cover this period yet. Nothing would be paid unless they do."}
      </p>
    </div>
  );
}
