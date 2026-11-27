// HR reports: headcount, turnover, attendance, tardiness, leave usage, probation and regularization.

import type { Employee, SeparationReason } from "../types";
import { addDays, displayName, formatDate } from "../format";
import { requestDays } from "../leave";
import { legalStatus, PROBATION_MAX_DAYS, probationEndFor, separationLabel, statusLabel } from "../employment";

import type { ReportDef, Viewer } from "./types";
import {
  attendanceFor, attendanceRate, datesBetween, employedOn, groupLabel, groupOf, monthEnd, monthLabel, monthsBack, orgScope, pct, people, r2, rangeText, recordsIndex,
} from "./common";

const hrOnly = (v: Viewer) => (v.kind === "key" || v.role === "admin" || v.role === "hr" ? "all" : false) as "all" | false;
const hrOrExec = (v: Viewer) => (v.kind === "key" || v.role === "admin" || v.role === "hr" || v.role === "executive" ? "all" : false) as "all" | false;
/** Attendance-type reports: HR and operations see everyone; managers see their direct reports. */
const teamReport = (v: Viewer) => (v.kind === "key" || v.role === "admin" || v.role === "hr" || v.role === "operations" ? "all" : v.isManager ? "team" : false) as "all" | "team" | false;

const VOLUNTARY: SeparationReason[] = ["resignation", "retirement"];
const ART296 = { label: "Labor Code Art. 296 (probationary employment)", url: "https://lawphil.net/statutes/presdecs/pd1974/pd_442_1974.html" };

export const headcount: ReportDef = {
  key: "headcount", title: "Headcount", category: "hr", access: hrOrExec,
  description: "Active people on a date by group, and hires and separations each month for the last 12 months.",
  filters: ["as_of", "org", "group_by"],
  run(db, p, scope) {
    const all = people(db, p, scope);
    const active = all.filter((e) => employedOn(e, p.as_of));
    const groups = new Map<string, Employee[]>();
    for (const e of active) { const g = groupOf(db, e, p.group_by); groups.set(g, [...(groups.get(g) ?? []), e]); }
    const months = monthsBack(p.as_of, 12);
    const yearAgo = addDays(p.as_of, -365);
    const rows = [...groups].sort((a, b) => b[1].length - a[1].length).map(([g, list]) => ({
      group: g, headcount: list.length,
      full_time: list.filter((e) => e.employment_type === "full_time").length,
      other: list.filter((e) => e.employment_type !== "full_time").length,
      hires_12m: all.filter((e) => groupOf(db, e, p.group_by) === g && e.start_date > yearAgo && e.start_date <= p.as_of).length,
      separations_12m: all.filter((e) => groupOf(db, e, p.group_by) === g && e.end_date && e.end_date > yearAgo && e.end_date <= p.as_of).length,
      share: pct(list.length, active.length),
    }));
    const then = all.filter((e) => employedOn(e, yearAgo)).length;
    return {
      scope: `As of ${formatDate(p.as_of)}${orgScope(db, p)}`,
      columns: [
        { key: "group", label: groupLabel[p.group_by], kind: "text" }, { key: "headcount", label: "Headcount", kind: "number" },
        { key: "full_time", label: "Full time", kind: "number" }, { key: "other", label: "Part time and contract", kind: "number" },
        { key: "hires_12m", label: "Hires, 12 months", kind: "number" }, { key: "separations_12m", label: "Separations, 12 months", kind: "number" },
        { key: "share", label: "Share", kind: "percent" },
      ],
      rows,
      totals: { group: "Total", headcount: active.length, full_time: rows.reduce((n, r) => n + r.full_time, 0), other: rows.reduce((n, r) => n + r.other, 0), hires_12m: rows.reduce((n, r) => n + r.hires_12m, 0), separations_12m: rows.reduce((n, r) => n + r.separations_12m, 0), share: 100 },
      kpis: [
        { label: "Headcount", value: active.length, kind: "number" },
        { label: "Change over 12 months", value: active.length - then, kind: "number", note: `${then} a year earlier` },
        { label: "Starting soon", value: all.filter((e) => e.start_date > p.as_of && !e.end_date).length, kind: "number", note: "Hired, not started yet" },
      ],
      charts: [
        { kind: "line", title: "Headcount at month end", x: months.map(monthLabel), valueKind: "number", series: [{ name: "Headcount", values: months.map((m) => all.filter((e) => employedOn(e, m === p.as_of.slice(0, 7) ? p.as_of : monthEnd(m))).length) }] },
        { kind: "columns", title: "Hires and separations each month", x: months.map(monthLabel), valueKind: "number", series: [
          { name: "Hires", values: months.map((m) => all.filter((e) => e.start_date.startsWith(m)).length) },
          { name: "Separations", values: months.map((m) => all.filter((e) => e.end_date?.startsWith(m)).length) },
        ] },
      ],
    };
  },
};

export const turnover: ReportDef = {
  key: "turnover", title: "Turnover", category: "hr", access: hrOrExec,
  description: "Who left in the range, why, and the turnover rate: separations divided by average headcount.",
  filters: ["range", "org", "group_by"],
  run(db, p, scope) {
    const all = people(db, p, scope);
    const left = all.filter((e) => e.end_date && e.end_date >= p.from && e.end_date <= p.to).sort((a, b) => b.end_date!.localeCompare(a.end_date!));
    const avg = (all.filter((e) => employedOn(e, p.from)).length + all.filter((e) => employedOn(e, p.to)).length) / 2;
    const vol = left.filter((e) => VOLUNTARY.includes(e.separation_reason!)).length;
    const days = (Date.parse(p.to) - Date.parse(p.from)) / 86400000 + 1;
    const reasons = new Map<string, number>();
    for (const e of left) { const r = e.separation_reason ? separationLabel[e.separation_reason] : "Not recorded"; reasons.set(r, (reasons.get(r) ?? 0) + 1); }
    return {
      scope: `${rangeText(p)}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "group", label: groupLabel[p.group_by], kind: "text" }, { key: "job_title", label: "Job title", kind: "text" },
        { key: "start_date", label: "Started", kind: "date" }, { key: "end_date", label: "Last day", kind: "date" }, { key: "tenure_months", label: "Tenure, months", kind: "number" },
        { key: "reason", label: "Reason", kind: "text" }, { key: "type", label: "Type", kind: "text" },
      ],
      rows: left.map((e) => ({
        name: displayName(e), group: groupOf(db, e, p.group_by), job_title: e.job_title, start_date: e.start_date, end_date: e.end_date,
        tenure_months: r2((Date.parse(e.end_date!) - Date.parse(e.start_date)) / (86400000 * 30.44)),
        reason: e.separation_reason ? separationLabel[e.separation_reason] : "Not recorded",
        type: e.separation_reason && VOLUNTARY.includes(e.separation_reason) ? "Voluntary" : "Involuntary",
      })),
      kpis: [
        { label: "Separations", value: left.length, kind: "number" },
        { label: "Turnover rate", value: avg ? r2((left.length / avg) * 100) : 0, kind: "percent", note: `Average headcount ${r2(avg)}` },
        { label: "Annualized", value: avg ? r2((left.length / avg) * 100 * (365 / days)) : 0, kind: "percent", note: `Over ${Math.round(days)} days` },
        { label: "Voluntary", value: vol, kind: "number", note: `${left.length - vol} involuntary` },
      ],
      charts: left.length ? [{ kind: "bars", title: "Separations by reason", valueKind: "number", items: [...reasons].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value) }] : [],
    };
  },
};

function attendanceRows(db: Parameters<ReportDef["run"]>[0], p: Parameters<ReportDef["run"]>[1], scope: (e: Employee) => boolean, nowIso: string) {
  // Days that are over: today's shift may still be running.
  const dates = datesBetween(p.from, p.to).filter((d) => d < nowIso.slice(0, 10));
  const recs = recordsIndex(db);
  return people(db, p, scope).filter((e) => e.shift_code_id).map((e) => ({ e, t: attendanceFor(db, e, dates, recs, nowIso) })).filter((x) => x.t.scheduled > 0);
}

export const attendance: ReportDef = {
  key: "attendance", title: "Attendance", category: "hr", access: teamReport,
  description: "Per person: scheduled days, present, absent, on leave, attendance rate, late arrivals, undertime and days with no time out.",
  filters: ["range", "org"],
  run(db, p, scope, nowIso) {
    const list = attendanceRows(db, p, scope, nowIso);
    const sum = (f: (t: (typeof list)[number]["t"]) => number) => list.reduce((n, x) => n + f(x.t), 0);
    const T = { scheduled: sum((t) => t.scheduled), present: sum((t) => t.present), absent: sum((t) => t.absent), leave: sum((t) => t.leave), late: sum((t) => t.late), lateMin: sum((t) => t.lateMin), undertimeMin: sum((t) => t.undertimeMin), noTimeOut: sum((t) => t.noTimeOut) };
    const byDept = new Map<string, typeof T>();
    for (const { e, t } of list) {
      const g = groupOf(db, e, "department");
      const a = byDept.get(g) ?? { scheduled: 0, present: 0, absent: 0, leave: 0, late: 0, lateMin: 0, undertimeMin: 0, noTimeOut: 0 };
      for (const k of Object.keys(a) as (keyof typeof a)[]) a[k] += t[k];
      byDept.set(g, a);
    }
    return {
      scope: `${rangeText(p)}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "department", label: "Department", kind: "text" },
        { key: "scheduled", label: "Scheduled days", kind: "number" }, { key: "present", label: "Present", kind: "number" }, { key: "absent", label: "Absent", kind: "number" },
        { key: "leave", label: "On leave", kind: "number" }, { key: "rate", label: "Attendance", kind: "percent" }, { key: "late", label: "Late arrivals", kind: "number" },
        { key: "undertime", label: "Undertime", kind: "minutes" }, { key: "no_time_out", label: "No time out", kind: "number" },
      ],
      rows: list.sort((a, b) => attendanceRate(a.t) - attendanceRate(b.t)).map(({ e, t }) => ({
        name: displayName(e), department: groupOf(db, e, "department"), scheduled: t.scheduled, present: t.present, absent: t.absent, leave: t.leave,
        rate: attendanceRate(t), late: t.late, undertime: t.undertimeMin, no_time_out: t.noTimeOut,
      })),
      totals: { name: "Total", department: "", scheduled: T.scheduled, present: T.present, absent: T.absent, leave: T.leave, rate: attendanceRate(T), late: T.late, undertime: T.undertimeMin, no_time_out: T.noTimeOut },
      kpis: [
        { label: "Attendance rate", value: attendanceRate(T), kind: "percent", note: "Present out of expected days" },
        { label: "Absences", value: T.absent, kind: "number" },
        { label: "Late arrivals", value: T.late, kind: "number", note: `${pct(T.late, T.present)}% of days present` },
        { label: "No time out", value: T.noTimeOut, kind: "number", note: "Need a correction" },
      ],
      charts: [{ kind: "bars", title: "Attendance rate by department", valueKind: "percent", items: [...byDept].map(([label, t]) => ({ label, value: attendanceRate(t) })).sort((a, b) => a.value - b.value) }],
      notes: ["Expected days are scheduled working days that aren't regular holidays, less approved full-day leave. Approved half-day leave counts as present when they timed in."],
    };
  },
};

export const tardiness: ReportDef = {
  key: "tardiness", title: "Tardiness", category: "hr", access: teamReport,
  description: "Late arrivals and late minutes per person, most minutes first. Arrivals within the shift's grace period aren't late.",
  filters: ["range", "org"],
  run(db, p, scope, nowIso) {
    const list = attendanceRows(db, p, scope, nowIso).filter((x) => x.t.late > 0 || x.t.undertimeMin > 0);
    const byDept = new Map<string, number>();
    for (const { e, t } of list) byDept.set(groupOf(db, e, "department"), (byDept.get(groupOf(db, e, "department")) ?? 0) + t.lateMin);
    const late = list.reduce((n, x) => n + x.t.late, 0), lateMin = list.reduce((n, x) => n + x.t.lateMin, 0);
    return {
      scope: `${rangeText(p)}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "department", label: "Department", kind: "text" }, { key: "present", label: "Days present", kind: "number" },
        { key: "late", label: "Late arrivals", kind: "number" }, { key: "late_rate", label: "Late, share of days", kind: "percent" },
        { key: "late_minutes", label: "Late, total", kind: "minutes" }, { key: "average", label: "Late, average", kind: "minutes" }, { key: "undertime", label: "Undertime", kind: "minutes" },
      ],
      rows: list.sort((a, b) => b.t.lateMin - a.t.lateMin).map(({ e, t }) => ({
        name: displayName(e), department: groupOf(db, e, "department"), present: t.present, late: t.late, late_rate: pct(t.late, t.present),
        late_minutes: t.lateMin, average: t.late ? Math.round(t.lateMin / t.late) : 0, undertime: t.undertimeMin,
      })),
      kpis: [
        { label: "Late arrivals", value: late, kind: "number" },
        { label: "Late time", value: lateMin, kind: "minutes" },
        { label: "People late at least once", value: list.filter((x) => x.t.late > 0).length, kind: "number" },
      ],
      charts: byDept.size ? [{ kind: "bars", title: "Late minutes by department", valueKind: "minutes", items: [...byDept].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value) }] : [],
    };
  },
};

export const leaveUsage: ReportDef = {
  key: "leave-usage", title: "Leave usage", category: "hr", access: teamReport,
  description: "Approved and pending leave days in the range, by leave type and by department.",
  filters: ["range", "org"],
  run(db, p, scope) {
    const ids = new Set(people(db, p, scope).map((e) => e.id));
    const inRange = db.leave_requests.filter((r) => ids.has(r.employee_id) && r.start_date <= p.to && r.end_date >= p.from && (r.status === "approved" || r.status === "pending"));
    const daysIn = (r: (typeof inRange)[number]) => requestDays(db, { ...r, start_date: r.start_date < p.from ? p.from : r.start_date, end_date: r.end_date > p.to ? p.to : r.end_date });
    const types = new Map<string, { name: string; paid: boolean; approved: number; pending: number; requests: number; people: Set<string> }>();
    const byDept = new Map<string, number>();
    for (const r of inRange) {
      const t = db.leave_types.find((x) => x.id === r.leave_type_id);
      const k = t?.id ?? r.leave_type_id;
      const row = types.get(k) ?? { name: t?.name ?? k, paid: !!t?.paid, approved: 0, pending: 0, requests: 0, people: new Set() };
      const d = daysIn(r);
      if (r.status === "approved") {
        row.approved += d;
        const e = db.employees.find((x) => x.id === r.employee_id)!;
        byDept.set(groupOf(db, e, "department"), (byDept.get(groupOf(db, e, "department")) ?? 0) + d);
      } else row.pending += d;
      row.requests++; row.people.add(r.employee_id);
      types.set(k, row);
    }
    const rows = [...types.values()].sort((a, b) => b.approved - a.approved).map((t) => ({ type: t.name, paid: t.paid ? "Paid" : "Unpaid", approved_days: r2(t.approved), pending_days: r2(t.pending), requests: t.requests, people: t.people.size }));
    return {
      scope: `${rangeText(p)}${orgScope(db, p)}`,
      columns: [
        { key: "type", label: "Leave type", kind: "text" }, { key: "paid", label: "Pay", kind: "text" }, { key: "approved_days", label: "Approved days", kind: "days" },
        { key: "pending_days", label: "Pending days", kind: "days" }, { key: "requests", label: "Requests", kind: "number" }, { key: "people", label: "People", kind: "number" },
      ],
      rows,
      totals: { type: "Total", paid: "", approved_days: r2(rows.reduce((n, r) => n + r.approved_days, 0)), pending_days: r2(rows.reduce((n, r) => n + r.pending_days, 0)), requests: rows.reduce((n, r) => n + r.requests, 0), people: new Set(inRange.map((r) => r.employee_id)).size },
      kpis: [
        { label: "Approved leave days", value: r2(rows.reduce((n, r) => n + r.approved_days, 0)), kind: "days" },
        { label: "Pending", value: r2(rows.reduce((n, r) => n + r.pending_days, 0)), kind: "days", note: "Waiting for approval" },
        { label: "People on leave", value: new Set(inRange.filter((r) => r.status === "approved").map((r) => r.employee_id)).size, kind: "number" },
      ],
      charts: byDept.size ? [{ kind: "bars", title: "Approved leave days by department", valueKind: "days", items: [...byDept].map(([label, value]) => ({ label, value: r2(value) })).sort((a, b) => b.value - a.value) }] : [],
      notes: ["Days count working days on each person's schedule, not rest days or holidays, except leave types counted in calendar days. Only the part of a request inside the range counts."],
    };
  },
};

export const probation: ReportDef = {
  key: "probation", title: "Probation and regularization", category: "hr", access: hrOnly,
  description: "Everyone on probation, when it ends, whether standards were given at hiring, and regularizations due in the next 60 days or made in the last 90.",
  filters: ["as_of", "org"],
  sources: [ART296],
  run(db, p, scope) {
    const soon = addDays(p.as_of, 60), recent = addDays(p.as_of, -90);
    const list = people(db, p, scope).filter((e) => e.employment_status_ph && !e.end_date).map((e) => {
      const end = e.probation_end_date ?? probationEndFor(e.start_date);
      const law = legalStatus(e, p.as_of);
      const onProbation = e.employment_status_ph === "probationary";
      return { e, end, law, onProbation };
    }).filter((x) => x.onProbation || (x.e.regularized_on && x.e.regularized_on >= recent && x.e.regularized_on <= p.as_of) || (x.e.start_date > addDays(p.as_of, -PROBATION_MAX_DAYS) && x.end <= soon));
    const daysLeft = (end: string) => Math.round((Date.parse(end) - Date.parse(p.as_of)) / 86400000);
    const rows = list.sort((a, b) => a.end.localeCompare(b.end)).map(({ e, end, law, onProbation }) => ({
      name: displayName(e), department: groupOf(db, e, "department"), start_date: e.start_date, probation_end: onProbation ? end : null,
      days_left: onProbation ? daysLeft(end) : null, standards_given: e.standards_given_on ? (e.standards_given_on <= e.start_date ? "At hiring" : "Late") : "No",
      status: onProbation ? (law.status === "regular" ? "Regular by law" : daysLeft(end) <= 30 ? "Decision due" : "On probation") : `Regularized ${e.regularized_on ? formatDate(e.regularized_on) : ""}`.trim(),
      note: law.reason ?? (e.employment_status_ph ? statusLabel[e.employment_status_ph] : ""),
    }));
    return {
      scope: `As of ${formatDate(p.as_of)}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "department", label: "Department", kind: "text" }, { key: "start_date", label: "Started", kind: "date" },
        { key: "probation_end", label: "Probation ends", kind: "date" }, { key: "days_left", label: "Days left", kind: "number" },
        { key: "standards_given", label: "Standards given", kind: "text" }, { key: "status", label: "Status", kind: "text" }, { key: "note", label: "Note", kind: "text" },
      ],
      rows,
      kpis: [
        { label: "On probation", value: list.filter((x) => x.onProbation).length, kind: "number" },
        { label: "Decision due in 30 days", value: list.filter((x) => x.onProbation && daysLeft(x.end) <= 30 && daysLeft(x.end) >= 0).length, kind: "number" },
        { label: "Regular by law", value: list.filter((x) => x.onProbation && x.law.status === "regular").length, kind: "number", note: "No standards given, or probation ran out" },
      ],
      notes: ["Probation can't exceed six months (180 days). Someone who wasn't told the standards for regularization when hired, or who is still working after probation ends, is regular by law (Art. 296)."],
    };
  },
};

export const HR_REPORTS = [headcount, turnover, attendance, tardiness, leaveUsage, probation];
