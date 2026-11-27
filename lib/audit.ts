// The change log: who changed what, field by field. The web app diffs each write (lib/store.ts commit),
// the API logs through the repository, and Postgres has a trigger for anything else (migration 0010).

import type { AuditEntry, Database, Employee } from "./types";
import { displayName } from "./format";

/** Tables whose changes aren't logged: the log itself, and notifications (they're messages, not records). */
const SKIP = new Set(["audit_log", "notifications"]);
/** Fields that are noise or too large to keep. */
const QUIET = new Set(["updated_at", "data"]);

const show = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.startsWith("data:")) return "(photo)";
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
};

const ENTITY: Record<string, string> = {
  employees: "Employee", compensation: "Compensation", time_records: "Time record", overtime_requests: "Overtime request",
  correction_requests: "Correction request", leave_requests: "Leave request", payroll_periods: "Payroll period", payslips: "Payslip",
  pay_items: "Pay item", pay_item_types: "Pay type", leave_types: "Leave type", shift_codes: "Shift code", shift_assignments: "Shift",
  departments: "Department", locations: "Branch", clients: "Client", employment_events: "Employment event", onboarding_cases: "Onboarding",
  onboarding_tasks: "Onboarding task", employee_payroll_settings: "Payroll override", leave_adjustments: "Leave adjustment",
  payroll_settings: "Payroll settings", schedule_settings: "Scheduling rules", approval_settings: "Approval roles", holidays: "Holiday",
};
export const entityLabel = (t: string) => ENTITY[t] ?? t.replace(/_/g, " ");

type Row = Record<string, unknown>;
const keyOf = (r: Row) => String(r.id ?? r.employee_id ?? r.organization_id ?? JSON.stringify(r).slice(0, 40));

function describe(db: Database, entity: string, r: Row): string {
  const person = (id: unknown) => { const e = db.employees.find((x) => x.id === id); return e ? displayName(e) : String(id ?? ""); };
  const label = entityLabel(entity);
  if (entity === "employees") return `${label}: ${person(r.id)}`;
  if (r.employee_id) return `${label} for ${person(r.employee_id)}${r.work_date ? `, ${r.work_date}` : r.start_date ? `, ${r.start_date}` : ""}`;
  if (r.name) return `${label}: ${r.name}`;
  if (r.code) return `${label}: ${r.code}`;
  if (r.start_date) return `${label}: ${r.start_date} to ${r.end_date}`;
  return label;
}

/** Every row added, changed or removed between two snapshots. */
export function diffDatabases(prev: Database, next: Database, actor: { id: string | null; label: string }, at: string, newId: () => string, orgId: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  const mk = (action: AuditEntry["action"], entity: string, r: Row, changes: AuditEntry["changes"]): AuditEntry => ({
    id: newId(), organization_id: orgId, at, actor_id: actor.id, actor_label: actor.label, action, entity, entity_id: keyOf(r),
    summary: describe(next, entity, r), changes,
  });
  for (const t of Object.keys(next) as (keyof Database)[]) {
    if (SKIP.has(t) || prev[t] === next[t]) continue;
    const a = prev[t] as unknown, b = next[t] as unknown;
    if (!Array.isArray(a) || !Array.isArray(b)) {
      // One settings object per organization.
      const changes = fieldChanges(a as Row, b as Row);
      if (changes.length) out.push(mk("update", t, { id: t }, changes));
      continue;
    }
    const before = new Map((a as Row[]).map((r) => [keyOf(r), r]));
    const after = new Map((b as Row[]).map((r) => [keyOf(r), r]));
    for (const [k, r] of after) {
      const old = before.get(k);
      if (!old) out.push(mk("create", t, r, fieldChanges({}, r)));
      else if (old !== r) { const c = fieldChanges(old, r); if (c.length) out.push(mk("update", t, r, c)); }
    }
    for (const [k, r] of before) if (!after.has(k)) out.push(mk("delete", t, r, fieldChanges(r, {})));
  }
  return out;
}

function fieldChanges(a: Row, b: Row): AuditEntry["changes"] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out: AuditEntry["changes"] = [];
  for (const k of keys) {
    if (QUIET.has(k) || k === "id" || k === "organization_id") continue;
    const x = show(a?.[k]), y = show(b?.[k]);
    if (x !== y) out.push({ field: k, from: x, to: y });
  }
  return out;
}

export const actorFor = (e: Employee | undefined): { id: string | null; label: string } => (e ? { id: e.id, label: displayName(e) } : { id: null, label: "System" });

/**
 * History the sample data implies: hires, leave and time requests filed and decided, corrections applied,
 * payroll finalized. Real data gets this from the log as it happens.
 */
export function seedAuditLog(db: Database, orgId: string): AuditEntry[] {
  let n = 0;
  const id = () => `aud-seed-${++n}`;
  const person = (pid: string | null | undefined) => actorFor(db.employees.find((e) => e.id === pid));
  const out: AuditEntry[] = [];
  const push = (at: string, who: { id: string | null; label: string }, action: AuditEntry["action"], entity: string, entityId: string, summary: string, changes: AuditEntry["changes"]) =>
    out.push({ id: id(), organization_id: orgId, at, actor_id: who.id, actor_label: who.label, action, entity, entity_id: entityId, summary, changes });
  const name = (pid: string) => { const e = db.employees.find((x) => x.id === pid); return e ? displayName(e) : pid; };

  for (const e of db.employees) {
    if (e.start_date >= "2025-06-01") push(`${e.start_date}T01:00:00Z`, person("e10"), "create", "employees", e.id, `Employee: ${displayName(e)}`, [{ field: "job_title", from: null, to: e.job_title }, { field: "start_date", from: null, to: e.start_date }]);
    if (e.end_date) push(`${e.end_date}T09:00:00Z`, person("e10"), "update", "employees", e.id, `Employee: ${displayName(e)}`, [{ field: "status", from: "active", to: "offboarded" }, { field: "end_date", from: null, to: e.end_date }, { field: "separation_reason", from: null, to: e.separation_reason }]);
  }
  const reqs: [string, { id: string; employee_id: string; filed_at: string; status: string; decided_by: string | null; decided_at: string | null; decision_note: string | null; work_date?: string; start_date?: string }[]][] = [
    ["leave_requests", db.leave_requests], ["overtime_requests", db.overtime_requests], ["correction_requests", db.correction_requests],
  ];
  for (const [t, rows] of reqs) for (const r of rows) {
    const when = r.work_date ?? r.start_date;
    push(r.filed_at, person(r.employee_id), "create", t, r.id, `${entityLabel(t)} for ${name(r.employee_id)}, ${when}`, [{ field: "status", from: null, to: "pending" }]);
    if (r.decided_at && r.decided_by) push(r.decided_at, person(r.decided_by), "update", t, r.id, `${entityLabel(t)} for ${name(r.employee_id)}, ${when}`, [{ field: "status", from: "pending", to: r.status }, ...(r.decision_note ? [{ field: "decision_note", from: null, to: r.decision_note }] : [])]);
  }
  for (const p of db.payroll_periods) if (p.finalized_at) push(p.finalized_at, person(p.finalized_by), "update", "payroll_periods", p.id, `Payroll period: ${p.start_date} to ${p.end_date}`, [{ field: "status", from: "open", to: "finalized" }]);
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
