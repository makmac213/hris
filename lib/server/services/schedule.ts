// The operations schedule: read the calendar, assign shifts, cover gaps, and the notifications that come with leave.

import { z } from "zod";
import { addDays, daysBetween } from "@/lib/format";
import { type AssignmentInput, assignmentId, cellFor, checkAssignments, coverageGaps, datesFrom, HORIZON_LIMITS, lockReason, scheduledPeople, toAssignments } from "@/lib/schedule";
import { type Ctx, requireScheduler, requireScope, scheduleScope, selfId } from "../context";
import { forbidden, invalid, notFound } from "../errors";
import { isoDate, listQuery, paginate, parse } from "../validate";

const today = (ctx: Ctx) => ctx.now.slice(0, 10);
const MAX_DAYS = 42;

export const ScheduleQuery = z.object({
  from: isoDate, to: isoDate,
  department_id: z.string().optional(), branch_id: z.string().optional(), client_id: z.string().optional(), employee_id: z.string().optional(),
});

/** The calendar: one row per person, one entry per day, with leave, gaps and whether the day can be changed. */
export async function getSchedule(ctx: Ctx, query: unknown) {
  requireScope(ctx, "schedule:read");
  const q = parse(ScheduleQuery, query);
  const span = daysBetween(q.from, q.to) + 1;
  if (span < 1 || span > MAX_DAYS) throw invalid({ to: `Ask for 1 to ${MAX_DAYS} days at a time.` });
  const db = await ctx.repo.snapshot(ctx.orgId);
  const visible = scheduleScope(ctx, db);
  const people = scheduledPeople(db, q.from, q.to, { department_id: q.department_id, location_id: q.branch_id, client_id: q.client_id })
    .filter((e) => visible(e.id) && (!q.employee_id || e.id === q.employee_id));
  const dates = datesFrom(q.from, span);
  const byId = new Map(db.employees.map((e) => [e.id, e]));
  return {
    from: q.from, to: q.to,
    window: { first: today(ctx), last: addDays(today(ctx), db.schedule_settings.horizon_days) },
    data: people.map((e) => ({
      employee: { id: e.id, name: `${e.preferred_name ?? e.first_name} ${e.last_name}`, job_title: e.job_title, department_id: e.department_id, branch_id: e.location_id, client_id: e.client_id },
      days: dates.map((d) => {
        const c = cellFor(db, e, d, today(ctx), byId);
        return {
          date: d,
          shift_code_id: c.sched.working ? c.sched.shift?.id ?? null : null,
          rest_day: !c.sched.working,
          source: c.sched.source,
          covers_employee_id: c.sched.assignment?.covers_employee_id ?? null,
          leave: c.leave ? { request_id: c.leave.request.id, type: c.leave.type?.name ?? null, status: c.leave.status, half_day: c.leave.request.half_day } : null,
          coverage_gap: c.gap,
          covered_by: c.coveredBy?.id ?? null,
          short_notice: c.shortNotice,
          editable: c.editable,
          locked_reason: c.lockReason,
        };
      }),
    })),
  };
}

export const Entry = z.object({
  employee_id: z.string(), date: isoDate,
  shift_code_id: z.string().nullable(), // null: rest day
  covers_employee_id: z.string().nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});
export const PutSchedule = z.object({ entries: z.array(Entry).min(1).max(1000) });

/** Assigns shifts or rest days. All or nothing: one bad day and nothing is saved (422, details per employee:date). */
export async function putSchedule(ctx: Ctx, body: unknown) {
  requireScheduler(ctx);
  const { entries } = parse(PutSchedule, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const inputs: AssignmentInput[] = entries.map((x) => ({ employee_id: x.employee_id, work_date: x.date, shift_code_id: x.shift_code_id, covers_employee_id: x.covers_employee_id ?? null, note: x.note ?? null }));
  const seen = new Set<string>();
  for (const x of inputs) {
    const k = assignmentId(x.employee_id, x.work_date);
    if (seen.has(k)) throw invalid({ [k]: "The same person and day appear twice." });
    seen.add(k);
  }
  const { errors, warnings } = checkAssignments(db, inputs, today(ctx));
  if (Object.keys(errors).length) throw invalid(errors);
  const by = selfId(ctx) ?? (ctx.principal.kind === "key" ? `api-key:${ctx.principal.key.prefix}` : "system");
  const rows = await ctx.repo.upsert("shift_assignments", toAssignments(ctx.orgId, inputs, by, ctx.now));
  return { saved: rows.length, warnings };
}

export const ResetSchedule = z.object({ entries: z.array(z.object({ employee_id: z.string(), date: isoDate })).min(1).max(1000) });
/** Puts days back on the person's default shift. Past, locked and approved-leave days are refused. */
export async function resetSchedule(ctx: Ctx, body: unknown) {
  requireScheduler(ctx);
  const { entries } = parse(ResetSchedule, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const errors: Record<string, string> = {};
  for (const x of entries) {
    const e = db.employees.find((p) => p.id === x.employee_id);
    const why = e ? lockReason(db, e, x.date, today(ctx)) : "Unknown employee.";
    if (why) errors[assignmentId(x.employee_id, x.date)] = why;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const removed = await ctx.repo.remove("shift_assignments", "id", entries.map((x) => assignmentId(x.employee_id, x.date)));
  return { reset: removed };
}

export const GapsQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), department_id: z.string().optional(), branch_id: z.string().optional(), client_id: z.string().optional() });
/** Approved leave on scheduled shifts, from today on. */
export async function getGaps(ctx: Ctx, query: unknown) {
  requireScope(ctx, "schedule:read");
  const q = parse(GapsQuery, query);
  const from = q.from && q.from > today(ctx) ? q.from : today(ctx);
  const to = q.to ?? addDays(from, 13);
  const span = daysBetween(from, to) + 1;
  if (span < 1 || span > MAX_DAYS) throw invalid({ to: `Ask for 1 to ${MAX_DAYS} days at a time.` });
  const db = await ctx.repo.snapshot(ctx.orgId);
  const visible = scheduleScope(ctx, db);
  const people = scheduledPeople(db, from, to, { department_id: q.department_id, location_id: q.branch_id, client_id: q.client_id }).filter((e) => visible(e.id));
  return {
    data: coverageGaps(db, people, datesFrom(from, span), today(ctx)).map(({ employee: e, cell: c }) => ({
      employee_id: e.id, date: c.date, shift_code_id: c.sched.shift?.id ?? null, leave_request_id: c.leave?.request.id ?? null,
      leave_type: c.leave?.type?.name ?? null, short_notice: c.shortNotice, covered_by: c.coveredBy?.id ?? null,
    })),
  };
}

export async function getSettings(ctx: Ctx) {
  requireScope(ctx, "schedule:read");
  return (await ctx.repo.snapshot(ctx.orgId)).schedule_settings;
}
export const Settings = z.object({
  horizon_days: z.number().int().min(HORIZON_LIMITS.min).max(HORIZON_LIMITS.max),
  short_notice_hours: z.number().int().min(1).max(168),
}).partial().strict();
export async function putSettings(ctx: Ctx, body: unknown) {
  requireScheduler(ctx);
  return ctx.repo.updateScheduleSettings(ctx.orgId, parse(Settings, body));
}

// ---- Notifications -----------------------------------------------------------------

export const ListNotifications = listQuery.extend({ unread: z.enum(["true", "false"]).optional() });
export async function listNotifications(ctx: Ctx, query: unknown) {
  const me = selfId(ctx);
  if (!me) throw forbidden("Notifications belong to a person, not an API key.");
  const q = parse(ListNotifications, query);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const rows = db.notifications.filter((n) => n.recipient_id === me && (q.unread !== "true" || !n.read_at)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { ...paginate(rows, q), unread: db.notifications.filter((n) => n.recipient_id === me && !n.read_at).length };
}

export const MarkRead = z.object({ ids: z.array(z.string()).max(500).optional() });
/** Marks some (ids) or all of the caller's notifications read. */
export async function markRead(ctx: Ctx, body: unknown) {
  const me = selfId(ctx);
  if (!me) throw forbidden("Notifications belong to a person, not an API key.");
  const { ids } = parse(MarkRead, body ?? {});
  const db = await ctx.repo.snapshot(ctx.orgId);
  const mine = db.notifications.filter((n) => n.recipient_id === me && !n.read_at && (!ids || ids.includes(n.id)));
  if (ids?.some((id) => !db.notifications.some((n) => n.id === id && n.recipient_id === me))) throw notFound("Notification");
  for (const n of mine) await ctx.repo.update("notifications", "id", n.id, { read_at: ctx.now });
  return { marked: mine.length };
}

