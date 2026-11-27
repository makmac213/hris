"use client";

import { cancelRequest, useDb } from "@/lib/store";
import { displayName, formatDate } from "@/lib/format";
import { formatDuration, formatInstant } from "@/lib/time";
import type { RequestStatus, ShiftCode } from "@/lib/types";
import { Button } from "@/components/ui";
import { correctionKindLabel } from "./RequestDialogs";

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const map: Record<RequestStatus, [string, string]> = {
    pending: ["badge badge-on_leave", "Waiting for approval"],
    approved: ["badge badge-active", "Approved"],
    rejected: ["badge badge-danger", "Rejected"],
    cancelled: ["badge badge-offboarded", "Cancelled"],
  };
  const [cls, label] = map[status];
  return <span className={cls}>{label}</span>;
}

/** The employee's own overtime and correction requests, newest first. */
export function MyRequests({ employeeId, shift }: { employeeId: string; shift: ShiftCode }) {
  const db = useDb();
  const name = (id: string | null) => { const e = db.employees.find((x) => x.id === id); return e ? displayName(e) : ""; };
  const items = [
    ...db.overtime_requests.filter((r) => r.employee_id === employeeId).map((r) => ({
      type: "overtime" as const, id: r.id, date: r.work_date, filed: r.filed_at, status: r.status, note: r.decision_note, by: r.decided_by, reason: r.reason,
      title: `Overtime · ${formatInstant(r.start_at, shift.timezone)} to ${formatInstant(r.end_at, shift.timezone)} (${formatDuration((Date.parse(r.end_at) - Date.parse(r.start_at)) / 60000)})`,
    })),
    ...db.correction_requests.filter((r) => r.employee_id === employeeId).map((r) => ({
      type: "correction" as const, id: r.id, date: r.work_date, filed: r.filed_at, status: r.status, note: r.decision_note, by: r.decided_by, reason: r.reason,
      title: `${correctionKindLabel[r.kind]} · ${formatInstant(r.proposed_at, shift.timezone)}`,
    })),
  ].sort((a, b) => b.filed.localeCompare(a.filed));

  if (!items.length) return <p className="muted">No requests yet. File overtime before or after you work it, and request a correction if a time record is wrong or missing.</p>;

  return (
    <ul className="req-list">
      {items.map((it) => (
        <li key={it.id} className="req">
          <div className="req-main">
            <span className="req-title"><strong>{it.title}</strong></span>
            <span className="muted">{formatDate(it.date)} · {it.reason}</span>
            {it.status !== "pending" && it.by && (
              <span className={it.status === "rejected" ? "text-danger" : "muted"}>
                {it.status === "approved" ? "Approved" : "Rejected"} by {name(it.by)}{it.note ? `: “${it.note}”` : ""}
              </span>
            )}
          </div>
          <div className="req-side">
            <RequestStatusBadge status={it.status} />
            {it.status === "pending" && <Button size="sm" variant="ghost" onClick={() => cancelRequest(it.type, it.id)}>Withdraw</Button>}
          </div>
        </li>
      ))}
    </ul>
  );
}
