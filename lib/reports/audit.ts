// Audit reports: the change log, approvals history and corrections history.

import { displayName } from "../format";
import { formatInstant } from "../time";
import { entityLabel } from "../audit";
import type { ReportDef, Viewer } from "./types";
import { pct, people, r2, rangeText } from "./common";

const adminOnly = (v: Viewer) => (v.kind === "user" && v.role === "admin" ? "all" : false) as "all" | false;
const adminHr = (v: Viewer) => (v.kind === "key" || v.role === "admin" || v.role === "hr" ? "all" : false) as "all" | false;
const inRange = (iso: string, from: string, to: string) => iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;
const has = (q: string | undefined, ...xs: (string | null | undefined)[]) => !q || xs.some((x) => x?.toLowerCase().includes(q.toLowerCase()));
const hours = (a: string, b: string) => r2((Date.parse(b) - Date.parse(a)) / 3600000);
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : r2((s[m - 1] + s[m]) / 2); };

export const auditTrail: ReportDef = {
  key: "audit-trail", title: "Audit trail", category: "audit", access: adminOnly,
  description: "Who changed what and when, field by field, from the web app, the API and the database. Admin only, so HR's own changes get reviewed.",
  filters: ["range", "q"],
  run(db, p) {
    const rows = db.audit_log.filter((a) => inRange(a.at, p.from, p.to) && has(p.q, a.actor_label, a.summary, entityLabel(a.entity), ...a.changes.map((c) => c.field)))
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((a) => ({
        at: a.at, actor: a.actor_label, action: a.action === "create" ? "Created" : a.action === "delete" ? "Deleted" : "Changed",
        record: a.summary, changes: a.changes.slice(0, 8).map((c) => `${c.field}: ${c.from ?? "empty"} to ${c.to ?? "empty"}`).join("; ") + (a.changes.length > 8 ? `; and ${a.changes.length - 8} more` : ""),
      }));
    const actors = new Map<string, number>();
    for (const r of rows) actors.set(r.actor, (actors.get(r.actor) ?? 0) + 1);
    return {
      scope: `${rangeText(p)}${p.q ? ` · matching "${p.q}"` : ""}`,
      columns: [
        { key: "at", label: "When", kind: "datetime" }, { key: "actor", label: "Who", kind: "text" }, { key: "action", label: "Action", kind: "text" },
        { key: "record", label: "Record", kind: "text" }, { key: "changes", label: "Changes", kind: "text" },
      ],
      rows,
      kpis: [{ label: "Changes", value: rows.length, kind: "number" }, { label: "People and keys", value: actors.size, kind: "number" }],
      charts: actors.size ? [{ kind: "bars", title: "Changes by who made them", valueKind: "number", items: [...actors].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 10) }] : [],
      notes: ["Photos and long values are shortened. The log can't be edited or deleted from the app."],
    };
  },
};

export const approvals: ReportDef = {
  key: "approvals", title: "Approvals history", category: "audit", access: adminHr,
  description: "Every leave, overtime and correction request filed in the range: who filed it, who decided it, how long it took, the outcome and the note.",
  filters: ["range", "org", "q"],
  run(db, p, scope) {
    const ids = new Set(people(db, p, scope).map((e) => e.id));
    const name = (id: string | null) => { const e = db.employees.find((x) => x.id === id); return e ? displayName(e) : ""; };
    const all = [
      ...db.leave_requests.map((r) => ({ type: "Leave", r, date: r.start_date, detail: db.leave_types.find((t) => t.id === r.leave_type_id)?.name ?? "" })),
      ...db.overtime_requests.map((r) => ({ type: "Overtime", r, date: r.work_date, detail: `${formatInstant(r.start_at)} to ${formatInstant(r.end_at)}` })),
      ...db.correction_requests.map((r) => ({ type: "Correction", r, date: r.work_date, detail: r.kind.replace("_", " ") })),
    ].filter((x) => ids.has(x.r.employee_id) && inRange(x.r.filed_at, p.from, p.to) && has(p.q, name(x.r.employee_id), name(x.r.decided_by), x.type, x.detail));
    const rows = all.sort((a, b) => b.r.filed_at.localeCompare(a.r.filed_at)).map(({ type, r, date, detail }) => ({
      type, employee: name(r.employee_id), for_date: date, detail, filed_at: r.filed_at, status: r.status[0].toUpperCase() + r.status.slice(1),
      decided_by: name(r.decided_by), decided_at: r.decided_at, hours: r.decided_at ? hours(r.filed_at, r.decided_at) : null, note: r.decision_note ?? "",
    }));
    const decided = rows.filter((r) => r.hours !== null);
    return {
      scope: `Filed ${rangeText(p)}`,
      columns: [
        { key: "type", label: "Type", kind: "text" }, { key: "employee", label: "Employee", kind: "text" }, { key: "for_date", label: "For", kind: "date" }, { key: "detail", label: "Detail", kind: "text" },
        { key: "filed_at", label: "Filed", kind: "datetime" }, { key: "status", label: "Status", kind: "text" }, { key: "decided_by", label: "Decided by", kind: "text" },
        { key: "decided_at", label: "Decided", kind: "datetime" }, { key: "hours", label: "Hours to decide", kind: "hours" }, { key: "note", label: "Note", kind: "text" },
      ],
      rows,
      kpis: [
        { label: "Requests", value: rows.length, kind: "number" },
        { label: "Pending", value: rows.filter((r) => r.status === "Pending").length, kind: "number" },
        { label: "Median time to decide", value: median(decided.map((r) => r.hours!)), kind: "hours" },
        { label: "Approved", value: pct(rows.filter((r) => r.status === "Approved").length, decided.length), kind: "percent", note: "Of those decided" },
      ],
    };
  },
};

export const corrections: ReportDef = {
  key: "corrections", title: "Corrections history", category: "audit", access: adminHr,
  description: "Every time correction filed in the range: the original time, the corrected time, who approved it and why. Originals are never edited.",
  filters: ["range", "org", "q"],
  run(db, p, scope) {
    const ids = new Set(people(db, p, scope).map((e) => e.id));
    const name = (id: string | null) => { const e = db.employees.find((x) => x.id === id); return e ? displayName(e) : ""; };
    const rows = db.correction_requests.filter((c) => ids.has(c.employee_id) && inRange(c.filed_at, p.from, p.to) && has(p.q, name(c.employee_id), name(c.decided_by), c.reason))
      .sort((a, b) => b.filed_at.localeCompare(a.filed_at))
      .map((c) => {
        const orig = db.time_records.find((r) => r.id === c.original_record_id);
        return {
          employee: name(c.employee_id), work_date: c.work_date, kind: { missing_in: "Missing time in", missing_out: "Missing time out", wrong_in: "Wrong time in", wrong_out: "Wrong time out" }[c.kind],
          original: orig ? formatInstant(orig.recorded_at) : "None", corrected: formatInstant(c.proposed_at), reason: c.reason,
          status: c.status[0].toUpperCase() + c.status.slice(1), decided_by: name(c.decided_by), decided_at: c.decided_at,
        };
      });
    return {
      scope: `Filed ${rangeText(p)}`,
      columns: [
        { key: "employee", label: "Employee", kind: "text" }, { key: "work_date", label: "Day", kind: "date" }, { key: "kind", label: "What", kind: "text" },
        { key: "original", label: "Original", kind: "text" }, { key: "corrected", label: "Corrected to", kind: "text" }, { key: "reason", label: "Reason", kind: "text" },
        { key: "status", label: "Status", kind: "text" }, { key: "decided_by", label: "Decided by", kind: "text" }, { key: "decided_at", label: "Decided", kind: "datetime" },
      ],
      rows,
      kpis: [
        { label: "Corrections", value: rows.length, kind: "number" },
        { label: "Approved", value: rows.filter((r) => r.status === "Approved").length, kind: "number" },
        { label: "Missing time out", value: rows.filter((r) => r.kind === "Missing time out").length, kind: "number", note: "Forgot to time out" },
      ],
    };
  },
};

export const AUDIT_REPORTS = [auditTrail, approvals, corrections];
