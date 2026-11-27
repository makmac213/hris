import { z } from "zod";
import type { Database, Employee, TimeRecord } from "@/lib/types";
import { scheduleFor, workDateFor } from "@/lib/schedule";
import { type Ctx, canSee, isPrivileged, requireScope, selfId } from "../context";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { isoDate, isoInstant, listQuery, paginate, parse } from "../validate";

export { workDateFor };

export const ListTimeRecords = listQuery.extend({ employee_id: z.string().optional(), from: isoDate.optional(), to: isoDate.optional() });
export async function listTimeRecords(ctx: Ctx, query: unknown) {
  requireScope(ctx, "requests:read");
  const q = parse(ListTimeRecords, query);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const who = q.employee_id ?? selfId(ctx);
  if (who && !canSee(ctx, db, who, { manager: true })) throw forbidden();
  if (!who && !isPrivileged(ctx)) throw forbidden();
  const rows = db.time_records.filter((r) => (!who || r.employee_id === who) && (!q.from || r.work_date >= q.from) && (!q.to || r.work_date <= q.to));
  return paginate(rows, q);
}

export const CreateTimeRecord = z.object({
  kind: z.enum(["clock_in", "clock_out"]),
  photo_path: z.string().min(1, "A photo is required."),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0),
  device: z.string().max(120).nullable().default(null),
  // Devices only (API key with time:write): the person, and the punch time from an offline queue.
  employee_id: z.string().optional(),
  recorded_at: isoInstant.optional(),
});
export async function createTimeRecord(ctx: Ctx, body: unknown) {
  requireScope(ctx, "time:write");
  const input = parse(CreateTimeRecord, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const isKey = ctx.principal.kind === "key";
  if (!isKey && (input.employee_id && input.employee_id !== selfId(ctx))) throw forbidden("People record their own time. Devices use an API key.");
  if (!isKey && input.recorded_at) throw invalid({ recorded_at: "The server sets the time. Only devices can send one." });
  if (isKey && !input.employee_id) throw invalid({ employee_id: "Say whose time this is." });
  const emp = db.employees.find((e) => e.id === (input.employee_id ?? selfId(ctx)));
  if (!emp) throw notFound("Employee");
  if (emp.status === "offboarded") throw conflict("This person no longer works here.");
  if (!emp.shift_code_id) throw conflict("No shift code assigned. HR assigns one before time can be recorded.");
  const at = input.recorded_at ?? ctx.now;
  if (Date.parse(at) > Date.parse(ctx.now) + 2 * 60000) throw invalid({ recorded_at: "That time hasn't happened yet." });
  const workDate = workDateFor(db, emp, at);
  if (db.payroll_periods.some((p) => p.status !== "open" && workDate >= p.start_date && workDate <= p.end_date)) {
    throw conflict("Payroll for this date is finalized. File a correction or ask HR for an adjustment.");
  }
  const day = db.time_records.filter((r) => r.employee_id === emp.id && r.work_date === workDate && r.source === "device");
  const shiftId = scheduleFor(db, emp, workDate).assignment?.shift_code_id ?? emp.shift_code_id;
  if (input.kind === "clock_in" && day.some((r) => r.kind === "clock_in")) throw conflict("There's already a time in for this day.");
  if (input.kind === "clock_out" && !day.some((r) => r.kind === "clock_in")) throw conflict("Record a time in first.");
  if (input.kind === "clock_out" && day.some((r) => r.kind === "clock_out")) throw conflict("There's already a time out for this day. File a correction to change it.");
  const rec: TimeRecord = {
    id: ctx.repo.newId("tr"), organization_id: ctx.orgId, employee_id: emp.id, shift_code_id: shiftId, kind: input.kind,
    recorded_at: at, work_date: workDate, source: "device", correction_request_id: null, photo_path: input.photo_path,
    latitude: input.latitude, longitude: input.longitude, accuracy_m: input.accuracy_m, device: input.device ?? (isKey ? `api-key:${ctx.principal.kind === "key" ? ctx.principal.key.prefix : ""}` : null),
  };
  return ctx.repo.insert("time_records", rec);
}
