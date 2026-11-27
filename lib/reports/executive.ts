// The executive dashboard: a few KPIs, four charts and one row per group.

import { addDays } from "../format";
import { coverageGaps, datesFrom } from "../schedule";
import { requestDays } from "../leave";
import { slipFor } from "../payslips";
import type { ReportDef, Viewer } from "./types";
import { attendanceFor, attendanceRate, datesBetween, employedOn, groupLabel, groupOf, monthEnd, monthLabel, monthsBack, orgScope, pct, people, r2, recordsIndex } from "./common";
import { latestClosed } from "./payroll";

const access = (v: Viewer) => (v.kind === "key" || v.role === "admin" || v.role === "hr" || v.role === "executive" ? "all" : false) as "all" | false;

export const executive: ReportDef = {
  key: "executive", title: "Executive dashboard", category: "executive", access,
  description: "Headcount, turnover, attendance, leave and payroll cost at a glance, with trends and a row per department, branch or client.",
  filters: ["as_of", "org", "group_by"],
  run(db, p, scope, nowIso) {
    const all = people(db, p, scope);
    const asOf = p.as_of;
    const active = all.filter((e) => employedOn(e, asOf));
    const yearAgo = addDays(asOf, -365);
    const left12 = all.filter((e) => e.end_date && e.end_date > yearAgo && e.end_date <= asOf);
    const avg12 = (all.filter((e) => employedOn(e, yearAgo)).length + active.length) / 2;
    const days30 = datesBetween(addDays(asOf, -30), addDays(asOf, -1));
    const recs = recordsIndex(db);
    const att = active.filter((e) => e.shift_code_id).map((e) => ({ e, t: attendanceFor(db, e, days30, recs, nowIso) }));
    const T = att.reduce((a, { t }) => ({ ...a, scheduled: a.scheduled + t.scheduled, present: a.present + t.present, leave: a.leave + t.leave, late: a.late + t.late }), { scheduled: 0, present: 0, absent: 0, leave: 0, late: 0, lateMin: 0, undertimeMin: 0, noTimeOut: 0 });
    const year = asOf.slice(0, 4);
    const ids = new Set(all.map((e) => e.id));
    const leaveDays = db.leave_requests.filter((r) => r.status === "approved" && ids.has(r.employee_id) && r.start_date.startsWith(year) && r.start_date <= asOf).reduce((n, r) => n + requestDays(db, r), 0);
    const period = latestClosed(db);
    const slips = period ? active.map((e) => ({ e, s: slipFor(db, e, period, nowIso) })).filter((x) => x.s) : [];
    const cost = (s: NonNullable<(typeof slips)[number]["s"]>) => s.gross + s.employer.reduce((n, l) => n + l.amount, 0);
    const otHours = slips.reduce((n, { s }) => n + s!.days.reduce((m, d) => m + d.otMin, 0), 0) / 60;
    const gaps = coverageGaps(db, active, datesFrom(asOf, 14), asOf).filter((g) => !g.cell.coveredBy).length;

    const groups = [...new Set(all.map((e) => groupOf(db, e, p.group_by)))];
    const rows = groups.map((g) => {
      const inG = (e: (typeof all)[number]) => groupOf(db, e, p.group_by) === g;
      const hc = active.filter(inG).length;
      const sep = left12.filter(inG).length;
      const avg = (all.filter((e) => inG(e) && employedOn(e, yearAgo)).length + hc) / 2;
      const a = att.filter((x) => inG(x.e)).reduce((acc, { t }) => ({ ...acc, scheduled: acc.scheduled + t.scheduled, present: acc.present + t.present, leave: acc.leave + t.leave }), { scheduled: 0, present: 0, absent: 0, leave: 0, late: 0, lateMin: 0, undertimeMin: 0, noTimeOut: 0 });
      return {
        group: g, headcount: hc, hires_12m: all.filter((e) => inG(e) && e.start_date > yearAgo && e.start_date <= asOf).length, separations_12m: sep,
        turnover: avg ? r2((sep / avg) * 100) : 0, attendance: a.scheduled ? attendanceRate(a) : null,
        payroll_cost: r2(slips.filter((x) => inG(x.e)).reduce((n, x) => n + cost(x.s!), 0)),
      };
    }).filter((r) => r.headcount > 0 || r.separations_12m > 0).sort((a, b) => b.headcount - a.headcount);
    const months = monthsBack(asOf, 12);

    return {
      scope: `As of ${asOf}${orgScope(db, p)} · by ${groupLabel[p.group_by].toLowerCase()}`,
      kpis: [
        { label: "Headcount", value: active.length, kind: "number", note: `${active.length - all.filter((e) => employedOn(e, yearAgo)).length >= 0 ? "+" : ""}${active.length - all.filter((e) => employedOn(e, yearAgo)).length} over 12 months` },
        { label: "Turnover, 12 months", value: avg12 ? r2((left12.length / avg12) * 100) : 0, kind: "percent", note: `${left12.length} left` },
        { label: "Attendance, 30 days", value: attendanceRate(T), kind: "percent", note: `${pct(T.late, T.present)}% late arrivals` },
        { label: `Leave days taken, ${year}`, value: r2(leaveDays), kind: "days" },
        { label: "Payroll cost, last period", value: r2(slips.reduce((n, x) => n + cost(x.s!), 0)), kind: "money", note: period ? `${period.start_date} to ${period.end_date}` : undefined },
        { label: "Overtime, last period", value: r2(otHours), kind: "hours" },
        { label: "Shifts needing cover", value: gaps, kind: "number", note: "Next 14 days" },
      ],
      charts: [
        { kind: "line", title: "Headcount at month end", x: months.map(monthLabel), valueKind: "number", series: [{ name: "Headcount", values: months.map((m) => all.filter((e) => employedOn(e, m === asOf.slice(0, 7) ? asOf : monthEnd(m))).length) }] },
        { kind: "columns", title: "Hires and separations each month", x: months.map(monthLabel), valueKind: "number", series: [
          { name: "Hires", values: months.map((m) => all.filter((e) => e.start_date.startsWith(m)).length) },
          { name: "Separations", values: months.map((m) => all.filter((e) => e.end_date?.startsWith(m)).length) },
        ] },
        { kind: "bars", title: `Payroll cost by ${groupLabel[p.group_by].toLowerCase()}, last period`, valueKind: "money", items: rows.filter((r) => r.payroll_cost > 0).map((r) => ({ label: r.group, value: r.payroll_cost })).sort((a, b) => b.value - a.value) },
        { kind: "bars", title: `Attendance by ${groupLabel[p.group_by].toLowerCase()}, 30 days`, valueKind: "percent", items: rows.filter((r) => r.attendance !== null).map((r) => ({ label: r.group, value: r.attendance! })).sort((a, b) => a.value - b.value) },
      ],
      columns: [
        { key: "group", label: groupLabel[p.group_by], kind: "text" }, { key: "headcount", label: "Headcount", kind: "number" }, { key: "hires_12m", label: "Hires, 12 months", kind: "number" },
        { key: "separations_12m", label: "Separations, 12 months", kind: "number" }, { key: "turnover", label: "Turnover", kind: "percent" }, { key: "attendance", label: "Attendance, 30 days", kind: "percent" },
        { key: "payroll_cost", label: "Payroll cost, last period", kind: "money" },
      ],
      rows,
      notes: ["Payroll cost is gross pay plus employer contributions for people on the Philippine payroll, from the latest finalized period. Attendance covers people with a shift code."],
    };
  },
};
