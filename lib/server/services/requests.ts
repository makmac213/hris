// Overtime, time correction and leave requests: file, list, decide, withdraw.

import { z } from "zod";
import type { CorrectionRequest, Database, LeaveRequest, OvertimeRequest, TimeRecord } from "@/lib/types";
import { localToIso, spanMinutes } from "@/lib/time";
import { requestDays, validateLeave } from "@/lib/leave";
import { type Ctx, canDecide, canSee, deciderId, isPrivileged, requireScope, selfId } from "../context";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { isoDate, isoInstant, listQuery, paginate, parse } from "../validate";

type Kind = "overtime" | "correction" | "leave";
const TABLE = { overtime: "overtime_requests", correction: "correction_requests", leave: "leave_requests" } as const;
type AnyRequest = OvertimeRequest | CorrectionRequest | LeaveRequest;
const dateOf = (r: AnyRequest) => ("work_date" in r ? r.work_date : r.start_date);
const isLocked = (db: Database, date: string) => db.payroll_periods.some((p) => p.status !== "open" && date >= p.start_date && date <= p.end_date);

/** The person filing: themselves. API keys can't file on someone's behalf. */
function filer(ctx: Ctx) {
  const id = selfId(ctx);
  if (!id) throw forbidden("Requests are filed by the person, not an API key.");
  return id;
}

export const ListRequests = listQuery.extend({
  employee_id: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  scope: z.enum(["mine", "to_decide"]).default("mine"),
});
export async function listRequests(ctx: Ctx, kind: Kind, query: unknown) {
  requireScope(ctx, "requests:read");
  const q = parse(ListRequests, query);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const rows = db[TABLE[kind]] as AnyRequest[];
  let visible: AnyRequest[];
  if (q.employee_id) {
    if (!canSee(ctx, db, q.employee_id, { manager: true })) throw forbidden();
    visible = rows.filter((r) => r.employee_id === q.employee_id);
  } else if (q.scope === "to_decide") {
    visible = rows.filter((r) => canDecide(ctx, db, r.employee_id));
  } else {
    const me = selfId(ctx);
    visible = me ? rows.filter((r) => r.employee_id === me) : isPrivileged(ctx) ? rows : [];
  }
  return paginate(visible.filter((r) => !q.status || r.status === q.status), q);
}

export const FileOvertime = z.object({ work_date: isoDate, start_at: isoInstant, end_at: isoInstant, reason: z.string().trim().min(10, "Say what the work was, in a sentence.") });
export async function fileOvertime(ctx: Ctx, body: unknown) {
  requireScope(ctx, "requests:write");
  const input = parse(FileOvertime, body);
  const me = filer(ctx);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const emp = db.employees.find((e) => e.id === me)!;
  const comp = db.compensation.find((c) => c.employee_id === me && c.on_ph_payroll);
  if (comp?.is_managerial) throw conflict("Managerial staff aren't paid overtime (Labor Code Art. 82).");
  const shift = db.shift_codes.find((s) => s.id === emp.shift_code_id);
  if (!shift) throw conflict("No shift code assigned.");
  const s = Date.parse(input.start_at), e = Date.parse(input.end_at);
  const errors: Record<string, string> = {};
  if (isLocked(db, input.work_date)) errors.work_date = "Payroll for this date is already finalized. Ask HR for a payroll adjustment instead.";
  if (e <= s || e - s > 12 * 3600000) errors.end_at = "Overtime must be between a few minutes and 12 hours.";
  const weekend = [0, 6].includes(new Date(`${input.work_date}T00:00:00Z`).getUTCDay());
  const sched0 = Date.parse(localToIso(input.work_date, shift.start_time, shift.timezone));
  const sched1 = sched0 + spanMinutes(shift) * 60000;
  if (!weekend && s < sched1 && e > sched0) errors.start_at = "This overlaps the scheduled shift. Overtime has to be outside scheduled hours.";
  if (db.overtime_requests.some((r) => r.employee_id === me && (r.status === "pending" || r.status === "approved") && Date.parse(r.start_at) < e && Date.parse(r.end_at) > s)) {
    errors.start_at = "There's already a pending or approved request for this time.";
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const row: OvertimeRequest = { ...input, id: ctx.repo.newId("ot"), employee_id: me, status: "pending", filed_at: ctx.now, decided_by: null, decided_at: null, decision_note: null };
  return ctx.repo.insert("overtime_requests", row);
}

export const FileCorrection = z.object({
  work_date: isoDate, kind: z.enum(["missing_in", "missing_out", "wrong_in", "wrong_out"]), proposed_at: isoInstant,
  reason: z.string().trim().min(10, "Explain what happened, in a sentence."),
});
export async function fileCorrection(ctx: Ctx, body: unknown) {
  requireScope(ctx, "requests:write");
  const input = parse(FileCorrection, body);
  const me = filer(ctx);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const recordKind = input.kind.endsWith("_in") ? "clock_in" : "clock_out";
  const existing = db.time_records.filter((r) => r.employee_id === me && r.work_date === input.work_date && r.kind === recordKind).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  const errors: Record<string, string> = {};
  if (input.work_date > ctx.now.slice(0, 10)) errors.work_date = "You can only correct days that have already happened.";
  else if (isLocked(db, input.work_date)) errors.work_date = "Payroll for this date is already finalized. Ask HR for a payroll adjustment instead.";
  if (Date.parse(input.proposed_at) > Date.parse(ctx.now)) errors.proposed_at = "That time hasn't happened yet.";
  if (input.kind.startsWith("missing") && existing) errors.kind = "There's already a record for this. Use wrong_in or wrong_out.";
  if (input.kind.startsWith("wrong") && !existing) errors.kind = "There's no record to fix on this day. Use missing_in or missing_out.";
  if (db.correction_requests.some((r) => r.employee_id === me && r.work_date === input.work_date && r.kind === input.kind && r.status === "pending")) errors.kind = "You already have a pending request for this.";
  if (Object.keys(errors).length) throw invalid(errors);
  const original = db.time_records.find((r) => r.employee_id === me && r.work_date === input.work_date && r.kind === recordKind && r.source === "device");
  const row: CorrectionRequest = { ...input, id: ctx.repo.newId("cr"), employee_id: me, original_record_id: input.kind.startsWith("wrong") ? original?.id ?? null : null, status: "pending", filed_at: ctx.now, decided_by: null, decided_at: null, decision_note: null };
  return ctx.repo.insert("correction_requests", row);
}

export const FileLeave = z.object({ leave_type_id: z.string(), start_date: isoDate, end_date: isoDate, half_day: z.boolean().default(false), reason: z.string().trim().min(3, "Add a short note for your approver.") });
export async function fileLeave(ctx: Ctx, body: unknown) {
  requireScope(ctx, "requests:write");
  const input = parse(FileLeave, body);
  const me = filer(ctx);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const emp = db.employees.find((e) => e.id === me)!;
  const t = db.leave_types.find((x) => x.id === input.leave_type_id && x.active);
  if (!t) throw invalid({ leave_type_id: "Unknown or inactive leave type." });
  const errors = validateLeave(db, emp, t, input.start_date, input.end_date, input.half_day, ctx.now.slice(0, 10));
  if (isLocked(db, input.start_date)) errors.start_date = "Payroll for this date is finalized. Ask HR to handle it as an adjustment.";
  if (Object.keys(errors).length) throw invalid(errors);
  const row: LeaveRequest = { ...input, id: ctx.repo.newId("lv"), employee_id: me, status: "pending", filed_at: ctx.now, decided_by: null, decided_at: null, decision_note: null };
  return { ...(await ctx.repo.insert("leave_requests", row)), days: requestDays(db, row) };
}

export const Decision = z.object({ approve: z.boolean(), note: z.string().trim().nullable().optional() })
  .refine((d) => d.approve || (d.note ?? "").length >= 5, { message: "Give a reason (5+ characters) when rejecting.", path: ["note"] });

export async function decide(ctx: Ctx, kind: Kind, id: string, body: unknown) {
  requireScope(ctx, "requests:write");
  const input = parse(Decision, body);
  const by = deciderId(ctx);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const req = (db[TABLE[kind]] as AnyRequest[]).find((r) => r.id === id);
  if (!req) throw notFound("Request");
  if (!canDecide(ctx, db, req.employee_id)) throw forbidden(req.employee_id === by ? "You can't decide your own request." : "Only their manager, admin or HR can decide this.");
  if (req.status !== "pending") throw conflict(`This request is already ${req.status}.`);
  if (isLocked(db, dateOf(req))) throw conflict("Payroll for this date is finalized. Handle it as a payroll adjustment.");
  const decided = { status: input.approve ? ("approved" as const) : ("rejected" as const), decided_by: by, decided_at: ctx.now, decision_note: input.approve ? input.note ?? null : input.note! };
  // Postgres: decide_correction() runs both writes in one transaction (migration 0005).
  const [row] = await ctx.repo.update(TABLE[kind], "id", id, decided as never);
  if (kind === "correction" && input.approve) {
    const c = req as CorrectionRequest;
    const emp = db.employees.find((e) => e.id === c.employee_id)!;
    const rec: TimeRecord = {
      id: ctx.repo.newId("tr"), organization_id: ctx.orgId, employee_id: c.employee_id, shift_code_id: emp.shift_code_id,
      kind: c.kind.endsWith("_in") ? "clock_in" : "clock_out", recorded_at: c.proposed_at, work_date: c.work_date,
      source: "correction", correction_request_id: id, photo_path: null, latitude: null, longitude: null, accuracy_m: null, device: null,
    };
    await ctx.repo.insert("time_records", rec);
  }
  return row;
}

export async function cancel(ctx: Ctx, kind: Kind, id: string) {
  requireScope(ctx, "requests:write");
  const me = filer(ctx);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const req = (db[TABLE[kind]] as AnyRequest[]).find((r) => r.id === id);
  if (!req) throw notFound("Request");
  if (req.employee_id !== me) throw forbidden("Only the person who filed it can withdraw it.");
  if (req.status !== "pending") throw conflict(`This request is already ${req.status}.`);
  const [row] = await ctx.repo.update(TABLE[kind], "id", id, { status: "cancelled" } as never);
  return row;
}
