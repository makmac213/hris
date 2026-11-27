// Philippine employment terms: probationary, regular, project, seasonal, casual and fixed-term employment.
// Labor Code Art. 295 [280] (regular and casual), Art. 296 [281] (probationary), Art. 297–299 [282–284] (termination),
// Brent School v. Zamora (fixed-term). Sources in docs/employment-rules.md.

import type { Database, Employee, EmploymentStatusPH, SeparationReason } from "./types";
import { addDays, formatDate } from "./format";

export const PROBATION_MAX_DAYS = 180; // Mitsubishi Motors v. Chrysler Philippines: six months = 180 days

export const statusLabel: Record<EmploymentStatusPH, string> = {
  probationary: "Probationary", regular: "Regular", project: "Project", seasonal: "Seasonal", casual: "Casual", fixed_term: "Fixed-term",
};

export const separationLabel: Record<SeparationReason, string> = {
  resignation: "Resignation",
  end_of_contract: "End of project, season or fixed term",
  failed_probation: "Did not meet probation standards",
  just_cause: "Dismissal for just cause (Art. 297)",
  redundancy: "Redundancy (Art. 298)",
  labor_saving: "Labor-saving devices (Art. 298)",
  retrenchment: "Retrenchment to prevent losses (Art. 298)",
  closure: "Closure, not due to serious losses (Art. 298)",
  closure_losses: "Closure due to serious losses (Art. 298)",
  disease: "Disease (Art. 299)",
  retirement: "Retirement",
  death: "Death",
};

export const probationEndFor = (start: string) => addDays(start, PROBATION_MAX_DAYS - 1);

export function monthsOfService(start: string, on: string) {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = on.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/** Years of service for separation and retirement pay: a fraction of at least six months counts as a whole year. */
export function creditedYears(start: string, end: string) {
  const m = monthsOfService(start, end);
  return Math.floor(m / 12) + (m % 12 >= 6 ? 1 : 0);
}

export function ageOn(birth: string, on: string) {
  return Math.floor(monthsOfService(birth, on) / 12);
}

/**
 * The status the law gives a person today, which can differ from what's on file:
 * probation past 180 days, or without written standards, is regular; a casual employee with a year of service is regular.
 */
export function legalStatus(e: Employee, today: string): { status: EmploymentStatusPH | null; reason: string | null } {
  const s = e.employment_status_ph;
  if (!s) return { status: null, reason: null };
  if (s === "probationary") {
    if (e.start_date > today && !e.standards_given_on) return { status: s, reason: null }; // not started: still time to give them
    if (!e.standards_given_on || e.standards_given_on > e.start_date) {
      return { status: "regular", reason: "No written probation standards were given at hiring, so the law treats them as regular from day one (Art. 296)." };
    }
    const end = e.probation_end_date ?? probationEndFor(e.start_date);
    const cap = probationEndFor(e.start_date);
    if (today > (end < cap ? end : cap)) return { status: "regular", reason: `Probation ended ${formatDate(end < cap ? end : cap)} without a decision, so they are regular by law (Art. 296).` };
  }
  if (s === "casual" && monthsOfService(e.start_date, today) >= 12) {
    return { status: "regular", reason: "A casual employee with at least a year of service is regular for that activity (Art. 295)." };
  }
  return { status: s, reason: null };
}

export interface EmploymentAlert {
  employee: Employee;
  severity: "danger" | "warn";
  message: string;
}

export function employmentAlerts(db: Database, today: string): EmploymentAlert[] {
  const out: EmploymentAlert[] = [];
  for (const e of db.employees) {
    if (!e.employment_status_ph || e.status === "offboarded" || e.end_date) continue;
    const legal = legalStatus(e, today);
    if (legal.reason && legal.status !== e.employment_status_ph) out.push({ employee: e, severity: "danger", message: legal.reason });
    if (e.employment_status_ph === "probationary" && e.start_date > today && !e.standards_given_on) {
      out.push({ employee: e, severity: "warn", message: `Starts ${formatDate(e.start_date)}. Give the probation standards in writing on or before day one, or they'll be regular from the start (Art. 296).` });
    }
    if (e.employment_status_ph === "probationary" && legal.status === "probationary") {
      const end = e.probation_end_date ?? probationEndFor(e.start_date);
      if (end > probationEndFor(e.start_date)) out.push({ employee: e, severity: "danger", message: `Probation is set to end ${formatDate(end)}, past the six-month limit (${formatDate(probationEndFor(e.start_date))}).` });
      const days = (Date.parse(end) - Date.parse(today)) / 86400000;
      if (days >= 0 && days <= 30) out.push({ employee: e, severity: "warn", message: `Probation ends ${formatDate(end)}. Regularize them, or give written notice that the standards weren't met before then.` });
    }
    if (["project", "seasonal", "fixed_term"].includes(e.employment_status_ph)) {
      if (!e.contract_end_date) out.push({ employee: e, severity: "danger", message: "No end date for the project, season or term. Without one, the engagement can be treated as regular." });
      else {
        const days = (Date.parse(e.contract_end_date) - Date.parse(today)) / 86400000;
        if (days >= 0 && days <= 30) out.push({ employee: e, severity: "warn", message: `Contract ends ${formatDate(e.contract_end_date)}. Decide whether to renew; repeated renewals for work that's necessary to the business can make them regular.` });
      }
    }
  }
  return out;
}
