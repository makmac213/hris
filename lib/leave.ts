// Leave: Philippine statutory leave as the floor, company policies on top. Sources in docs/leave-rules.md.

import type { Database, Employee, LeaveRequest, LeaveType } from "./types";
import { addDays } from "./format";
import { isWeekend } from "./time";
import { monthsOfService } from "./employment";
import { isScheduledWorkday } from "./schedule";

export const SIL_ID = "lt-sil";

/** Statutory leaves. Days are the legal minimum; a company can raise them, never lower them. */
export const STATUTORY_LEAVES: LeaveType[] = [
  {
    id: SIL_ID, name: "Service incentive leave", statutory: true, legal_basis: "Labor Code Art. 95", legal_min_days: 5, days: 5, accrual: "annual", calendar_days: false,
    min_service_months: 12, paid: true, convertible: true, carry_over_max: 0, counts_as_sil: true, requires_document: null,
    who: "Everyone with at least a year of service", description: "Unused days are paid in cash at the end of the year. Not required where the company already gives at least 5 paid vacation days.", active: true,
  },
  {
    id: "lt-maternity", name: "Maternity leave", statutory: true, legal_basis: "RA 11210", legal_min_days: 105, days: 105, accrual: "per_event", calendar_days: true,
    min_service_months: 0, paid: true, convertible: false, carry_over_max: 0, counts_as_sil: false, requires_document: "Medical certificate or birth certificate; SSS maternity notification",
    who: "Female employees, for each pregnancy. 120 days for solo parents; 60 days for miscarriage or emergency termination. Up to 7 days can be given to the father.",
    description: "Paid in full. The SSS benefit is advanced by the company and reimbursed by SSS; the company pays any salary difference.", active: true,
  },
  {
    id: "lt-paternity", name: "Paternity leave", statutory: true, legal_basis: "RA 8187", legal_min_days: 7, days: 7, accrual: "per_event", calendar_days: false,
    min_service_months: 0, paid: true, convertible: false, carry_over_max: 0, counts_as_sil: false, requires_document: "Birth certificate or medical certificate; marriage certificate",
    who: "Married male employees living with their spouse, for the first four deliveries or miscarriages", description: null, active: true,
  },
  {
    id: "lt-solo", name: "Solo parent leave", statutory: true, legal_basis: "RA 8972 as amended by RA 11861", legal_min_days: 7, days: 7, accrual: "annual", calendar_days: false,
    min_service_months: 6, paid: true, convertible: false, carry_over_max: 0, counts_as_sil: false, requires_document: "Solo Parent ID",
    who: "Solo parents with at least six months of service", description: null, active: true,
  },
  {
    id: "lt-vawc", name: "VAWC leave", statutory: true, legal_basis: "RA 9262 Sec. 43", legal_min_days: 10, days: 10, accrual: "annual", calendar_days: false,
    min_service_months: 0, paid: true, convertible: false, carry_over_max: 0, counts_as_sil: false, requires_document: "Barangay, prosecutor or court certification of a pending case",
    who: "Women employees who are victims of violence, and their children", description: "Can be extended when a protection order says so.", active: true,
  },
  {
    id: "lt-women", name: "Special leave for women", statutory: true, legal_basis: "RA 9710 (Magna Carta of Women)", legal_min_days: 60, days: 60, accrual: "per_event", calendar_days: true,
    min_service_months: 6, paid: true, convertible: false, carry_over_max: 0, counts_as_sil: false, requires_document: "Medical certificate and clinical summary",
    who: "Women recovering from surgery for a gynecological disorder, with six months of service in the last 12", description: "Up to two months with full pay.", active: true,
  },
];

/** Workdays in a range: the person's scheduled shift days when given (rotating rest days), else Monday to Friday. Holidays don't count. */
export function workdaysBetween(db: Database, start: string, end: string, employee?: Pick<Employee, "id" | "shift_code_id">): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (employee ? !isScheduledWorkday(db, employee, d) : isWeekend(d)) continue;
    const h = db.holidays.find((x) => x.date === d && x.kind !== "special_working");
    if (h) continue;
    out.push(d);
  }
  return out;
}

const personOf = (db: Database, id: string | undefined) => (id ? db.employees.find((e) => e.id === id) : undefined);

const calendarDays = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;

export function requestDays(db: Database, r: Pick<LeaveRequest, "start_date" | "end_date" | "half_day" | "leave_type_id"> & { employee_id?: string }) {
  if (r.half_day) return 0.5;
  const t = db.leave_types.find((x) => x.id === r.leave_type_id);
  return t?.calendar_days ? calendarDays(r.start_date, r.end_date) : workdaysBetween(db, r.start_date, r.end_date, personOf(db, r.employee_id)).length;
}

/** Leave types this person can see. SIL is hidden when a company leave of at least 5 paid days replaces it (Art. 95). */
export function leaveTypesFor(db: Database): LeaveType[] {
  const active = db.leave_types.filter((t) => t.active);
  const replaced = active.some((t) => !t.statutory && t.counts_as_sil && t.paid && t.days >= 5);
  return active.filter((t) => !(t.id === SIL_ID && replaced));
}

const roundHalf = (n: number) => Math.round(n * 2) / 2;

/** Days granted for the year, before carry-over and adjustments. */
export function grantedDays(t: LeaveType, e: Employee, year: number, asOf: string): number {
  if (t.accrual === "per_event") return t.days;
  const yStart = `${year}-01-01`, yEnd = `${year}-12-31`;
  const eligibleFrom = addMonths(e.start_date, t.min_service_months);
  if (eligibleFrom > yEnd || (e.end_date && e.end_date < yStart)) return 0;
  // Statutory leave is a yearly entitlement once eligible, not earned pro rata.
  if (t.statutory) return t.days;
  const from = eligibleFrom > yStart ? eligibleFrom : yStart;
  const to = e.end_date && e.end_date < yEnd ? e.end_date : yEnd;
  if (t.accrual === "annual") {
    // Joiners and leavers get the share of the year they're eligible for, in half days.
    const share = monthsOfService(from, addDays(to, 1)) / 12;
    return roundHalf(t.days * Math.min(1, share));
  }
  // Monthly: earned at the end of each full month of eligible service, up to today.
  const until = asOf < to ? asOf : to;
  return roundHalf((t.days / 12) * Math.min(12, monthsOfService(from, addDays(until, 1))));
}

function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export function usedDays(db: Database, employeeId: string, typeId: string, year: number, status: LeaveRequest["status"] = "approved") {
  return db.leave_requests
    .filter((r) => r.employee_id === employeeId && r.leave_type_id === typeId && r.status === status && r.start_date.slice(0, 4) === String(year))
    .reduce((n, r) => n + requestDays(db, r), 0);
}

export interface LeaveBalance {
  type: LeaveType;
  granted: number;
  carried: number;
  adjusted: number;
  used: number;
  pending: number;
  available: number; // per-event types: the days allowed per event
  eligibleFrom: string;
}

export function leaveBalance(db: Database, e: Employee, t: LeaveType, year: number, asOf: string, depth = 0): LeaveBalance {
  const granted = grantedDays(t, e, year, asOf);
  const adjusted = db.leave_adjustments.filter((a) => a.employee_id === e.id && a.leave_type_id === t.id && a.year === year).reduce((n, a) => n + a.days, 0);
  let carried = 0;
  if (t.carry_over_max > 0 && depth < 1 && t.accrual !== "per_event") {
    const prev = leaveBalance(db, e, t, year - 1, `${year - 1}-12-31`, depth + 1);
    carried = Math.min(t.carry_over_max, Math.max(0, prev.available));
  }
  const used = usedDays(db, e.id, t.id, year);
  const pending = usedDays(db, e.id, t.id, year, "pending");
  const available = t.accrual === "per_event" ? t.days : granted + carried + adjusted - used;
  return { type: t, granted, carried, adjusted, used, pending, available, eligibleFrom: addMonths(e.start_date, t.min_service_months) };
}

/** Unused convertible days paid in cash: at year end, or on separation (Art. 95). Carry-over is kept, not paid. */
export function convertibleDays(db: Database, e: Employee, year: number, asOf: string): { type: LeaveType; days: number }[] {
  return leaveTypesFor(db)
    .filter((t) => t.convertible && t.paid && t.accrual !== "per_event")
    .map((t) => {
      const b = leaveBalance(db, e, t, year, asOf);
      const keep = e.end_date ? 0 : t.carry_over_max;
      return { type: t, days: Math.max(0, b.available - keep) };
    })
    .filter((x) => x.days > 0);
}

/** Approved leave by date for one person: which days are on leave, paid or not, and half or whole. */
export function leaveByDate(db: Database, employeeId: string): Map<string, { type: LeaveType; paid: boolean; half: boolean }> {
  const out = new Map<string, { type: LeaveType; paid: boolean; half: boolean }>();
  for (const r of db.leave_requests) {
    if (r.employee_id !== employeeId || r.status !== "approved") continue;
    const t = db.leave_types.find((x) => x.id === r.leave_type_id);
    if (!t) continue;
    for (const d of workdaysBetween(db, r.start_date, r.end_date, personOf(db, employeeId))) out.set(d, { type: t, paid: t.paid, half: r.half_day });
  }
  return out;
}

export function validateLeave(db: Database, e: Employee, t: LeaveType, start: string, end: string, halfDay: boolean, today: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!start || !end || end < start) { errors.end = "The last day can’t be before the first."; return errors; }
  if (halfDay && start !== end) errors.end = "A half day is a single date.";
  const days = halfDay ? 0.5 : t.calendar_days ? calendarDays(start, end) : workdaysBetween(db, start, end, e).length;
  if (days === 0) errors.end = "Those dates are all rest days or holidays.";
  const eligible = addMonths(e.start_date, t.min_service_months);
  if (start < eligible) errors.type = `${t.name} needs ${t.min_service_months} months of service. Available from ${eligible}.`;
  const year = Number(start.slice(0, 4));
  if (end.slice(0, 4) !== start.slice(0, 4) && t.accrual !== "per_event") errors.end = "Split leave that crosses into the new year into two requests.";
  // Monthly credits can be used once earned: count what's earned by the first day of the leave.
  const b = leaveBalance(db, e, t, year, start > today ? start : today);
  if (!errors.type && (t.accrual === "per_event" ? days > t.days : days > b.available - b.pending)) {
    errors.type = t.accrual === "per_event" ? `${t.name} is up to ${t.days} days each time.` : `Only ${Math.max(0, b.available - b.pending)} days left${b.pending ? `, counting ${b.pending} pending` : ""}.`;
  }
  const overlap = db.leave_requests.some((r) => r.employee_id === e.id && (r.status === "pending" || r.status === "approved") && r.start_date <= end && r.end_date >= start);
  if (overlap) errors.start = "You already have leave on some of these dates.";
  return errors;
}
