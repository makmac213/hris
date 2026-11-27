import type {
  Database,
  Department,
  Employee,
  EmploymentStatus,
  EmploymentType,
  EmploymentEvent,
  EmployeeDocument,
  Location,
  OnboardingCase,
  OnboardingTask,
  OnboardingTemplateTask,
  AppRole,
  ShiftCode,
  TimeRecord,
  Compensation,
  CorrectionRequest,
  Holiday,
  HolidayKind,
  OvertimeRequest,
  PayrollPeriod,
  EmployeePayrollSettings,
  PayItem,
  PayItemType,
  LeaveType,
  LeaveRequest,
  LeaveAdjustment,
  PayrollOpening,
} from "./types";
import { DEFAULT_SETTINGS, monthlyContributions, periodFor, withholdingSemiMonthly } from "./payroll";
import { addDays } from "./format";
import { probationEndFor } from "./employment";
import { STATUTORY_LEAVES } from "./leave";
import { isWeekend, localToIso, phDefaultCodes, spanMinutes, zoned } from "./time";

// Sample company for the prototype. All people are fictional.
export const ORG_ID = "org-halden";
export const TODAY = "2026-11-27";
export const TEMPLATE_ID = "tpl-standard";

const departments: Department[] = [
  ["dep-exec", "Executive", "e01"],
  ["dep-eng", "Engineering", "e02"],
  ["dep-product", "Product", "e03"],
  ["dep-design", "Design", "e09"],
  ["dep-people", "People", "e04"],
  ["dep-finance", "Finance", "e05"],
  ["dep-sales", "Sales", "e11"],
  ["dep-cs", "Customer Success", "e28"],
  ["dep-marketing", "Marketing", "e31"],
].map(([id, name, head]) => ({ id, organization_id: ORG_ID, name, head_id: head }));

const locations: Location[] = [
  { id: "loc-mnl", organization_id: ORG_ID, name: "Manila", city: "Makati", country_code: "PH", timezone: "Asia/Manila", is_remote: false, ph_region: "NCR" },
  { id: "loc-ceb", organization_id: ORG_ID, name: "Cebu", city: "Cebu City", country_code: "PH", timezone: "Asia/Manila", is_remote: false, ph_region: "VII" },
  { id: "loc-sin", organization_id: ORG_ID, name: "Singapore", city: "Singapore", country_code: "SG", timezone: "Asia/Singapore", is_remote: false, ph_region: null },
  { id: "loc-syd", organization_id: ORG_ID, name: "Sydney", city: "Sydney", country_code: "AU", timezone: "Australia/Sydney", is_remote: false, ph_region: null },
  { id: "loc-sfo", organization_id: ORG_ID, name: "San Francisco", city: "San Francisco", country_code: "US", timezone: "America/Los_Angeles", is_remote: false, ph_region: null },
  { id: "loc-remote", organization_id: ORG_ID, name: "Remote", city: null, country_code: null, timezone: "UTC", is_remote: true, ph_region: null },
];

type Row = [
  id: string, first: string, last: string, title: string, dep: string, loc: string,
  manager: string | null, start: string, status?: EmploymentStatus, type?: EmploymentType, pronouns?: string,
];

const rows: Row[] = [
  ["e01", "Amara", "Okafor", "Chief Executive Officer", "dep-exec", "loc-sfo", null, "2019-03-04", "active", "full_time", "she/her"],
  ["e02", "Daniel", "Reyes", "Chief Technology Officer", "dep-eng", "loc-mnl", "e01", "2019-05-13", "active", "full_time", "he/him"],
  ["e03", "Hannah", "Cho", "VP of Product", "dep-product", "loc-sin", "e01", "2020-01-20"],
  ["e04", "Marisol", "Dela Cruz", "VP of People", "dep-people", "loc-mnl", "e01", "2020-06-01", "active", "full_time", "she/her"],
  ["e05", "Robert", "Adeyemi", "Chief Financial Officer", "dep-finance", "loc-sfo", "e01", "2021-02-15"],
  ["e06", "Priya", "Raman", "Engineering Manager, Platform", "dep-eng", "loc-sin", "e02", "2020-09-07"],
  ["e07", "Tomás", "Lindqvist", "Engineering Manager, Product", "dep-eng", "loc-remote", "e02", "2021-04-12"],
  ["e08", "Jasmine", "Villanueva", "Senior Product Manager", "dep-product", "loc-mnl", "e03", "2021-08-02"],
  ["e09", "Kenji", "Watanabe", "Head of Design", "dep-design", "loc-syd", "e03", "2021-01-11"],
  ["e10", "Leah", "Santos", "People Operations Manager", "dep-people", "loc-mnl", "e04", "2021-10-18"],
  ["e11", "Siobhan", "Murphy", "VP of Sales", "dep-sales", "loc-sfo", "e01", "2022-03-07"],
  ["e12", "Arjun", "Mehta", "Senior Software Engineer", "dep-eng", "loc-sin", "e06", "2021-06-14"],
  ["e13", "Carlo", "Bautista", "Software Engineer", "dep-eng", "loc-mnl", "e06", "2023-02-06"],
  ["e14", "Maximilian Alexander", "von Hohenberg-Castellanos", "Site Reliability Engineer", "dep-eng", "loc-remote", "e06", "2022-11-21"],
  ["e15", "Nadia", "Haddad", "Staff Software Engineer", "dep-eng", "loc-remote", "e07", "2021-05-03"],
  ["e16", "Miguel", "Ramos", "Software Engineer", "dep-eng", "loc-mnl", "e07", "2023-07-17"],
  ["e17", "Grace", "Liu", "Software Engineer", "dep-eng", "loc-syd", "e07", "2024-01-08", "on_leave"],
  ["e18", "Owen", "Fitzgerald", "QA Engineer", "dep-eng", "loc-sfo", "e07", "2022-08-29", "active", "contractor"],
  ["e19", "Isabel", "Navarro", "Product Manager", "dep-product", "loc-mnl", "e08", "2023-03-13"],
  ["e20", "Theo", "Bergström", "Senior Product Designer", "dep-design", "loc-remote", "e09", "2022-02-14"],
  ["e21", "Ana", "Castillo", "Product Designer", "dep-design", "loc-mnl", "e09", "2024-04-01"],
  ["e22", "Rafael", "Aquino", "People Partner", "dep-people", "loc-mnl", "e10", "2022-05-23"],
  ["e23", "Mei", "Tan", "Talent Acquisition Lead", "dep-people", "loc-sin", "e10", "2022-09-12"],
  ["e24", "Julia", "Novak", "Financial Controller", "dep-finance", "loc-sfo", "e05", "2021-11-01"],
  ["e25", "Paolo", "Mendoza", "Payroll Specialist", "dep-finance", "loc-mnl", "e24", "2023-01-16", "active", "part_time"],
  ["e26", "Ethan", "Brooks", "Account Executive", "dep-sales", "loc-sfo", "e11", "2022-10-03"],
  ["e27", "Zara", "Ahmed", "Account Executive", "dep-sales", "loc-sin", "e11", "2023-05-08"],
  ["e28", "Lucía", "Fernández", "Head of Customer Success", "dep-cs", "loc-syd", "e11", "2022-01-24"],
  ["e29", "Nathan", "Cruz", "Customer Success Manager", "dep-cs", "loc-ceb", "e28", "2023-09-04"],
  ["e30", "Chloe", "Martin", "Support Specialist", "dep-cs", "loc-syd", "e28", "2024-06-17"],
  ["e31", "Samuel", "Osei", "Head of Marketing", "dep-marketing", "loc-remote", "e01", "2022-07-11"],
  ["e32", "Bea", "Lim", "Content Lead", "dep-marketing", "loc-mnl", "e31", "2023-04-24"],
  ["e33", "Ivan", "Petrov", "Growth Marketer", "dep-marketing", "loc-remote", "e31", "2024-02-19"],
  // New hires in onboarding
  ["e34", "Diego", "Salazar", "Software Engineer", "dep-eng", "loc-mnl", "e06", "2026-12-01", "onboarding"],
  ["e35", "Rina", "Kobayashi", "Product Designer", "dep-design", "loc-syd", "e09", "2026-11-17", "onboarding"],
  ["e36", "Marcus", "Webb", "Account Executive", "dep-sales", "loc-sfo", "e11", "2026-12-08", "onboarding"],
  ["e37", "Kat", "Gonzales", "Payroll Analyst", "dep-finance", "loc-mnl", "e24", "2026-11-03", "onboarding", "full_time", "she/her"],
  // Former
  ["e38", "Victor", "Hale", "Account Executive", "dep-sales", "loc-sfo", "e11", "2022-04-04", "offboarded"],
];

const ROLES: Record<string, AppRole> = { e04: "admin", e10: "hr", e22: "hr" };

// ---- Shift codes -------------------------------------------------------------
// The nine Philippine defaults, plus two codes an admin uploaded for the Singapore and Sydney offices.
const shift_codes: ShiftCode[] = [
  ...phDefaultCodes(ORG_ID),
  { id: "sc-sg-d0900", organization_id: ORG_ID, code: "SG-D0900", name: "Singapore office day shift", kind: "whole_day", start_time: "09:00", end_time: "18:00", break_minutes: 60, timezone: "Asia/Singapore", grace_minutes: 10, source: "uploaded", is_default: false, archived_at: null },
  { id: "sc-syd-d0830", organization_id: ORG_ID, code: "SYD-D0830", name: "Sydney office day shift", kind: "whole_day", start_time: "08:30", end_time: "17:30", break_minutes: 60, timezone: "Australia/Sydney", grace_minutes: 10, source: "uploaded", is_default: false, archived_at: null },
];

const SHIFT_ASSIGNMENTS: Record<string, string> = {
  // Manila
  e02: "sc-ph-d0900", e04: "sc-ph-d0800", e08: "sc-ph-d0900", e10: "sc-ph-d0800", e13: "sc-ph-d1000",
  e16: "sc-ph-d1000", e19: "sc-ph-d0900", e21: "sc-ph-d0800", e22: "sc-ph-d0800", e25: "sc-ph-h0800",
  e29: "sc-ph-d2200", e32: "sc-ph-d0900", e34: "sc-ph-d0900", e37: "sc-ph-d0800",
  // Singapore
  e03: "sc-sg-d0900", e06: "sc-sg-d0900", e12: "sc-sg-d0900", e23: "sc-sg-d0900", e27: "sc-sg-d0900",
  // Sydney
  e09: "sc-syd-d0830", e17: "sc-syd-d0830", e28: "sc-syd-d0830", e30: "sc-syd-d0830", e35: "sc-syd-d0830",
};

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, "");

// Philippine employment terms. Everyone in a Philippine office is regular after a six-month probation,
// except the scripted cases below so each rule shows up somewhere.
const PH_TERMS: Record<string, Partial<Employee>> = {
  e02: { birth_date: "1964-03-10" }, // 62: eligible for retirement pay (RA 7641)
  e04: { birth_date: "1979-08-22" },
  e25: { employment_status_ph: "fixed_term", contract_end_date: "2026-12-15", regularized_on: null, probation_end_date: null }, // part-time, one-year contract
  e32: { employment_status_ph: "project", contract_end_date: null, regularized_on: null, probation_end_date: null }, // project with no end date: flagged
  e34: { employment_status_ph: "probationary", standards_given_on: null, regularized_on: null }, // starts Dec 1, standards not yet given
  e37: { employment_status_ph: "probationary", standards_given_on: "2026-11-03", regularized_on: null }, // on probation until May 1, 2027
};

const isPhLocation = (loc: string) => loc === "loc-mnl" || loc === "loc-ceb";

const employees: Employee[] = rows.map(([id, first, last, title, dep, loc, manager, start, status = "active", type = "full_time", pronouns]) => ({
  id,
  organization_id: ORG_ID,
  employee_number: `HLD-${id.slice(1).padStart(4, "0")}`,
  first_name: first,
  last_name: last,
  preferred_name: first === "Maximilian Alexander" ? "Max" : null,
  pronouns: pronouns ?? null,
  work_email: `${slug(first.split(" ")[0])}.${slug(last)}@halden.co`,
  phone: `+63 917 ${String(1000 + Number(id.slice(1)) * 37).slice(-4)} ${String(2000 + Number(id.slice(1)) * 53).slice(-4)}`,
  job_title: title,
  department_id: dep,
  location_id: loc,
  manager_id: manager,
  employment_type: type,
  status,
  start_date: start,
  end_date: status === "offboarded" ? "2026-09-30" : null,
  avatar_url: null,
  role: (ROLES[id] ?? "employee") as AppRole,
  shift_code_id: SHIFT_ASSIGNMENTS[id] ?? null,
  employment_status_ph: isPhLocation(loc) ? "regular" : null,
  probation_end_date: isPhLocation(loc) ? probationEndFor(start) : null,
  standards_given_on: isPhLocation(loc) ? start : null,
  contract_end_date: null,
  regularized_on: isPhLocation(loc) ? addDays(probationEndFor(start), 1) : null,
  birth_date: null,
  separation_reason: status === "offboarded" ? "resignation" : null,
  separation_notice_date: status === "offboarded" ? "2026-08-31" : null,
  ...(PH_TERMS[id] ?? {}),
}));

const employment_events: EmploymentEvent[] = [];
for (const e of employees) {
  employment_events.push({
    id: `ev-${e.id}-hire`, employee_id: e.id, effective_date: e.start_date, kind: "hired",
    job_title: e.job_title.replace(/^Senior |^Staff /, ""), department_id: e.department_id, note: null,
  });
  if (/^(Senior|Staff|Head|VP|Chief|Engineering Manager)/.test(e.job_title) && e.start_date < "2023-01-01") {
    employment_events.push({
      id: `ev-${e.id}-promo`, employee_id: e.id, effective_date: addDays(e.start_date, 540), kind: "promotion",
      job_title: e.job_title, department_id: e.department_id, note: "Annual review cycle",
    });
  }
}
employment_events.push(
  { id: "ev-e17-leave", employee_id: "e17", effective_date: "2026-10-12", kind: "leave", job_title: null, department_id: null, note: "Parental leave, returning 2027-01-11" },
  { id: "ev-e38-exit", employee_id: "e38", effective_date: "2026-09-30", kind: "transfer", job_title: null, department_id: null, note: "Resigned" },
);

const employee_documents: EmployeeDocument[] = employees.flatMap((e) => {
  const docs: EmployeeDocument[] = [
    { id: `doc-${e.id}-1`, employee_id: e.id, name: "Employment contract.pdf", category: "contract", storage_path: `${e.id}/contract.pdf`, size_bytes: 248_000, uploaded_at: e.start_date },
    { id: `doc-${e.id}-2`, employee_id: e.id, name: "Code of conduct acknowledgement.pdf", category: "policy", storage_path: `${e.id}/conduct.pdf`, size_bytes: 96_000, uploaded_at: e.start_date },
  ];
  if (e.status !== "onboarding") docs.push({ id: `doc-${e.id}-3`, employee_id: e.id, name: "Tax declaration 2026.pdf", category: "tax", storage_path: `${e.id}/tax-2026.pdf`, size_bytes: 132_000, uploaded_at: "2026-01-20" });
  return docs;
});

export const onboarding_template_tasks: OnboardingTemplateTask[] = (
  [
    ["Send contract and offer packet", "before_start", "people_team", -14],
    ["Collect signed contract and ID", "before_start", "new_hire", -10],
    ["Order and set up laptop", "before_start", "it", -5],
    ["Create email, Slack and HRIS accounts", "before_start", "it", -3],
    ["Choose an onboarding buddy", "before_start", "manager", -3],
    ["Welcome and team lunch", "first_day", "buddy", 0],
    ["Walk through benefits enrollment", "first_day", "people_team", 0],
    ["Complete security and privacy training", "first_day", "new_hire", 0],
    ["Set expectations in first 1:1", "first_week", "manager", 2],
    ["Submit payroll and tax forms", "first_week", "new_hire", 4],
    ["Introduce to cross-functional partners", "first_week", "manager", 4],
    ["Hold 30-day check-in", "first_90_days", "manager", 30],
    ["Hold 60-day check-in", "first_90_days", "manager", 60],
    ["Complete 90-day review", "first_90_days", "manager", 90],
  ] as const
).map(([title, phase, owner_role, due_offset_days], i) => ({
  id: `tt-${i + 1}`, template_id: TEMPLATE_ID, title, phase, owner_role, due_offset_days, position: i,
}));

export function buildOnboardingTasks(caseId: string, startDate: string, doneBefore: string | null): OnboardingTask[] {
  return onboarding_template_tasks.map((t) => {
    const due = addDays(startDate, t.due_offset_days);
    return {
      id: `${caseId}-t${t.position + 1}`,
      case_id: caseId,
      title: t.title,
      phase: t.phase,
      owner_role: t.owner_role,
      assignee_id: null,
      due_date: due,
      completed_at: doneBefore && due < doneBefore ? `${due}T09:00:00Z` : null,
      position: t.position,
    };
  });
}

const onboarding_cases: OnboardingCase[] = [
  { id: "ob-e37", employee_id: "e37", template_id: TEMPLATE_ID, buddy_id: "e25", status: "in_progress", created_at: "2026-10-15" },
  { id: "ob-e35", employee_id: "e35", template_id: TEMPLATE_ID, buddy_id: "e21", status: "in_progress", created_at: "2026-10-28" },
  { id: "ob-e34", employee_id: "e34", template_id: TEMPLATE_ID, buddy_id: "e13", status: "in_progress", created_at: "2026-11-10" },
  { id: "ob-e36", employee_id: "e36", template_id: TEMPLATE_ID, buddy_id: null, status: "in_progress", created_at: "2026-11-20" },
];

const onboarding_tasks: OnboardingTask[] = [
  ...buildOnboardingTasks("ob-e37", "2026-11-03", TODAY),
  // Rina: one first-week task slipped, so it shows as overdue.
  ...buildOnboardingTasks("ob-e35", "2026-11-17", TODAY).map((t) =>
    t.title === "Submit payroll and tax forms" ? { ...t, completed_at: null } : t),
  // Diego: IT setup is late.
  ...buildOnboardingTasks("ob-e34", "2026-12-01", "2026-11-22"),
  ...buildOnboardingTasks("ob-e36", "2026-12-08", "2026-11-25"),
];

// ---- Holidays (Proclamation No. 1006, s. 2025) ------------------------------------

const holidays: Holiday[] = [
  ["2026-01-01", "New Year’s Day", "regular"], ["2026-02-17", "Chinese New Year", "special_non_working"],
  ["2026-02-25", "EDSA People Power Anniversary", "special_working"], ["2026-04-02", "Maundy Thursday", "regular"],
  ["2026-04-03", "Good Friday", "regular"], ["2026-04-04", "Black Saturday", "special_non_working"],
  ["2026-04-09", "Araw ng Kagitingan", "regular"], ["2026-05-01", "Labor Day", "regular"],
  ["2026-06-12", "Independence Day", "regular"], ["2026-08-21", "Ninoy Aquino Day", "special_non_working"],
  ["2026-08-31", "National Heroes Day", "regular"], ["2026-11-01", "All Saints’ Day", "special_non_working"],
  ["2026-11-02", "All Souls’ Day", "special_non_working"], ["2026-11-30", "Bonifacio Day", "regular"],
  ["2026-12-08", "Feast of the Immaculate Conception", "special_non_working"], ["2026-12-24", "Christmas Eve", "special_non_working"],
  ["2026-12-25", "Christmas Day", "regular"], ["2026-12-30", "Rizal Day", "regular"],
  ["2026-12-31", "Last Day of the Year", "special_non_working"],
].map(([date, name, kind]) => ({ date, name, kind: kind as HolidayKind }));

const isHoliday = (d: string) => holidays.some((h) => h.date === d && h.kind !== "special_working");

// ---- Compensation (Philippine payroll: Manila staff) -------------------------------

const COMP: Record<string, [basis: "monthly" | "hourly", rate: number, managerial?: boolean]> = {
  e02: ["monthly", 380000, true], e04: ["monthly", 260000, true], e08: ["monthly", 120000], e10: ["monthly", 95000, true],
  e13: ["monthly", 70000], e16: ["monthly", 68000], e19: ["monthly", 85000], e21: ["monthly", 60000],
  e22: ["monthly", 52000], e25: ["hourly", 150], e29: ["monthly", 45000], e32: ["monthly", 58000],
  e34: ["monthly", 72000], e37: ["monthly", 32000],
};
const compensation: Compensation[] = Object.entries(COMP).map(([id, [basis, rate, managerial]]) => ({
  id: `comp-${id}`, employee_id: id, pay_basis: basis, rate, is_managerial: !!managerial, on_ph_payroll: true,
  effective_from: employees.find((e) => e.id === id)!.start_date,
}));

// ---- Time records -----------------------------------------------------------------
// Generated relative to the real current time so "today" and the open payroll period always look lived-in.

export const SEED_NOW = new Date().toISOString();

const OFFICE_GPS: Record<string, [number, number]> = {
  "loc-mnl": [14.5547, 121.0244],
  "loc-ceb": [10.3181, 123.9050],
  "loc-sin": [1.283, 103.851],
  "loc-syd": [-33.8688, 151.2093],
};
const DEVICES = ["iPhone · Safari", "Android · Chrome", "Windows · Chrome", "Mac · Safari"];

function rand(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const TODAY_LOCAL = zoned(SEED_NOW).date;
const CURRENT_PERIOD = periodFor(TODAY_LOCAL);
const PREVIOUS_PERIOD = periodFor(addDays(CURRENT_PERIOD.start_date, -1));

/** Ordinary workdays (no weekends, no holidays) from the previous period's start through today. */
const WORKDAYS: string[] = [];
for (let d = PREVIOUS_PERIOD.start_date; d <= TODAY_LOCAL; d = addDays(d, 1)) if (!isWeekend(d) && !isHoliday(d)) WORKDAYS.push(d);
const W = (fromEnd: number) => WORKDAYS[Math.max(0, WORKDAYS.length - 1 - fromEnd)];
const LAST_SATURDAY = (() => { let d = addDays(TODAY_LOCAL, -1); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, -1); return d; })();
const SPECIAL_DAY_WORKED = holidays.find((h) => h.kind === "special_non_working" && h.date >= PREVIOUS_PERIOD.start_date && h.date < TODAY_LOCAL && !isWeekend(h.date))?.date;

const at = (day: string, hm: string, tz = "Asia/Manila") => localToIso(day, hm, tz);

function buildTimeRecords(nowIso: string): TimeRecord[] {
  const now = Date.parse(nowIso);
  const out: TimeRecord[] = [];
  const today = TODAY_LOCAL;

  for (const e of employees) {
    const shift = shift_codes.find((s) => s.id === e.shift_code_id);
    if (!shift || e.status === "offboarded" || e.status === "on_leave") continue;
    const gps = OFFICE_GPS[e.location_id ?? ""] ?? OFFICE_GPS["loc-mnl"];
    const mk = (day: string, kind: TimeRecord["kind"], iso: string, r: (k: string) => number): TimeRecord => ({
      id: `tr-${e.id}-${day}-${kind}`,
      organization_id: ORG_ID,
      employee_id: e.id,
      shift_code_id: shift.id,
      kind,
      recorded_at: iso,
      work_date: day,
      source: "device",
      correction_request_id: null,
      photo_path: `mock:${e.id}`,
      latitude: +(gps[0] + (r(kind + "lat") - 0.5) * 0.0016).toFixed(6),
      longitude: +(gps[1] + (r(kind + "lng") - 0.5) * 0.0016).toFixed(6),
      accuracy_m: Math.round(6 + r(kind + "acc") * 30),
      device: DEVICES[Math.floor(r("dev") * DEVICES.length)],
    });

    const days = [...WORKDAYS];
    if (e.id === "e29") days.push(...holidays.filter((h) => h.date >= PREVIOUS_PERIOD.start_date && h.date < today && h.kind === "special_non_working" && !isWeekend(h.date)).map((h) => h.date));
    if (e.id === "e10" && SPECIAL_DAY_WORKED) days.push(SPECIAL_DAY_WORKED);

    for (const day of days) {
      if (day < e.start_date) continue;
      const r = (k: string) => rand(`${e.id}${day}${k}`);
      // Scripted exceptions so every rule shows up somewhere.
      if (e.id === "e13" && day === W(3)) continue; // absent
      if (e.id === "e08" && (day === W(4) || day === W(3))) continue; // approved vacation leave
      if (e.id === "e29" && day === W(7)) continue; // approved leave without pay
      if (e.id === "e32" && day === today) continue; // hasn't timed in yet
      let inOffset = Math.round(-14 + r("in") * 16); // mostly up to 14 minutes early
      if (e.id === "e16" && (day === W(4) || day === today)) inOffset = 18 + Math.round(r("late") * 10);
      if (e.id === "e27" && day === W(2)) inOffset = 34;
      if (e.id === "e32" && day === W(5)) inOffset = 41; // later corrected
      let outOffset = Math.round(r("out") * 22);
      if (e.id === "e19" && day === W(3)) outOffset = -45;
      if (e.id === "e13" && day === W(5)) outOffset = 152; // stayed for a release (approved OT)
      if (e.id === "e16" && day === W(1)) outOffset = 95; // OT filed, pending
      if (e.id === "e19" && day === W(6)) outOffset = 100; // OT filed, rejected
      if (e.id === "e22" && day === W(2)) outOffset = 240 - spanMinutes(shift); // half-day sick leave, left at noon

      const startIso = at(day, shift.start_time, shift.timezone);
      const inAt = Date.parse(startIso) + inOffset * 60000;
      const outAt = Date.parse(startIso) + (spanMinutes(shift) + outOffset) * 60000;
      if (inAt < now) out.push(mk(day, "clock_in", new Date(inAt).toISOString(), r));
      const forgotOut = (e.id === "e12" && day === W(2)) || (e.id === "e25" && day === W(2));
      if (outAt < now && !forgotOut) out.push(mk(day, "clock_out", new Date(outAt).toISOString(), r));
    }

    // Rafael worked a Saturday hiring event, with overtime approved in advance.
    if (e.id === "e22") {
      const r = (k: string) => rand(`${e.id}${LAST_SATURDAY}${k}`);
      out.push(mk(LAST_SATURDAY, "clock_in", at(LAST_SATURDAY, "08:56"), r), mk(LAST_SATURDAY, "clock_out", at(LAST_SATURDAY, "14:04"), r));
    }
  }
  return out;
}

// ---- Requests ---------------------------------------------------------------------

const overtime_requests: OvertimeRequest[] = [
  { id: "ot-1", employee_id: "e13", work_date: W(5), start_at: at(W(5), "19:00"), end_at: at(W(5), "21:30"), reason: "Production release for the payments service", status: "approved", filed_at: at(W(5), "17:10"), decided_by: "e06", decided_at: at(W(5), "17:45"), decision_note: null },
  { id: "ot-2", employee_id: "e22", work_date: LAST_SATURDAY, start_at: at(LAST_SATURDAY, "09:00"), end_at: at(LAST_SATURDAY, "14:00"), reason: "Campus hiring event at UP Diliman", status: "approved", filed_at: at(addDays(LAST_SATURDAY, -3), "10:00"), decided_by: "e10", decided_at: at(addDays(LAST_SATURDAY, -3), "11:20"), decision_note: null },
  { id: "ot-3", employee_id: "e16", work_date: W(1), start_at: at(W(1), "19:00"), end_at: at(W(1), "20:30"), reason: "Fix for the checkout bug reported by Customer Success", status: "pending", filed_at: at(W(1), "20:40"), decided_by: null, decided_at: null, decision_note: null },
  { id: "ot-4", employee_id: "e19", work_date: W(6), start_at: at(W(6), "18:00"), end_at: at(W(6), "19:30"), reason: "Finishing the roadmap deck", status: "rejected", filed_at: at(W(6), "19:35"), decided_by: "e08", decided_at: at(W(5), "09:15"), decision_note: "The deck isn’t due until next week. Please plan it within your hours." },
];

const correction_requests: CorrectionRequest[] = [
  { id: "cr-1", employee_id: "e32", work_date: W(5), kind: "wrong_in", proposed_at: at(W(5), "08:57"), original_record_id: `tr-e32-${W(5)}-clock_in`, reason: "The app froze at the entrance. I was at my desk before 9.", status: "approved", filed_at: at(W(5), "10:05"), decided_by: "e10", decided_at: at(W(4), "09:30"), decision_note: "Confirmed with the security log." },
  { id: "cr-2", employee_id: "e25", work_date: W(2), kind: "missing_out", proposed_at: at(W(2), "12:02"), original_record_id: null, reason: "My phone died before I could record my time out.", status: "pending", filed_at: at(W(1), "08:15"), decided_by: null, decided_at: null, decision_note: null },
  { id: "cr-3", employee_id: "e12", work_date: W(2), kind: "missing_out", proposed_at: at(W(2), "18:06", "Asia/Singapore"), original_record_id: null, reason: "Forgot to record my time out.", status: "pending", filed_at: at(W(1), "09:00"), decided_by: null, decided_at: null, decision_note: null },
];

const correctionRecords: TimeRecord[] = correction_requests.filter((c) => c.status === "approved").map((c) => ({
  id: `tr-corr-${c.id}`, organization_id: ORG_ID, employee_id: c.employee_id,
  shift_code_id: SHIFT_ASSIGNMENTS[c.employee_id] ?? null,
  kind: c.kind.endsWith("_in") ? "clock_in" : "clock_out", recorded_at: c.proposed_at, work_date: c.work_date,
  source: "correction", correction_request_id: c.id, photo_path: null, latitude: null, longitude: null, accuracy_m: null, device: null,
}));

const payroll_periods: PayrollPeriod[] = [
  { ...PREVIOUS_PERIOD, status: PREVIOUS_PERIOD.pay_date <= TODAY_LOCAL ? "paid" : "finalized", finalized_at: at(PREVIOUS_PERIOD.end_date, "18:00"), finalized_by: "e04" },
  { ...CURRENT_PERIOD, status: "open", finalized_at: null, finalized_by: null },
];

// ---- Payroll settings and pay items -------------------------------------------------

const payroll_settings = { ...DEFAULT_SETTINGS };

// Per-employee exceptions: the CEO's contributions are fully paid by the company; Miguel saves extra in Pag-IBIG.
const employee_payroll_settings: EmployeePayrollSettings[] = [
  { employee_id: "e02", employer_pays_sss: true, employer_pays_philhealth: true, employer_pays_pagibig: true, pagibig_voluntary: 0 },
  { employee_id: "e16", employer_pays_sss: null, employer_pays_philhealth: null, employer_pays_pagibig: null, pagibig_voluntary: 800 },
];

const P0 = PREVIOUS_PERIOD.start_date;
const P1 = CURRENT_PERIOD.start_date;
// Company-defined pay item types. Halden names them and sets their rules; the category is the legal treatment.
const T = (id: string, name: string, direction: PayItemType["direction"], category: PayItemType["category"], extra: Partial<PayItemType> = {}): PayItemType => ({
  id, name, direction, category, de_minimis_kind: null, description: null, default_amount: null, default_schedule: "every_cutoff",
  applies_to: "individual", counts_for_13th: false, is_statutory: false, active: true, ...extra,
});
const pay_item_types: PayItemType[] = [
  T("pt-rice", "Rice subsidy", "earning", "de_minimis", { de_minimis_kind: "rice", default_amount: 1250, applies_to: "rank_and_file", description: "₱2,500 a month for all rank-and-file staff, inside the de minimis ceiling." }),
  T("pt-laundry", "Laundry allowance", "earning", "de_minimis", { de_minimis_kind: "laundry", description: "For roles that wear uniforms." }),
  T("pt-uniform", "Uniform allowance", "earning", "de_minimis", { de_minimis_kind: "uniform", default_schedule: "once" }),
  T("pt-xmas", "Christmas gift", "earning", "de_minimis", { de_minimis_kind: "christmas_gift", default_amount: 5000, default_schedule: "once" }),
  T("pt-transpo", "Transportation allowance", "earning", "taxable_allowance", { description: "Fixed monthly allowance, not liquidated, so taxable." }),
  T("pt-comm", "Sales commission", "earning", "commission", { counts_for_13th: true, default_schedule: "once", description: "Halden counts commissions toward the 13th month (company practice)." }),
  T("pt-reimb", "Expense reimbursement", "earning", "reimbursement", { default_schedule: "once", description: "Liquidated with receipts." }),
  T("pt-bonus", "Project completion bonus", "earning", "other_benefit", { default_schedule: "once" }),
  T("pt-midyear", "Mid-year bonus", "earning", "other_benefit", { default_schedule: "once", description: "Half a month's salary, paid with the June 1–15 payroll, at management's discretion." }),
  T("pt-adj", "Pay adjustment", "earning", "adjustment", { default_schedule: "once" }),
  T("pt-sssloan", "SSS salary loan", "deduction", "sss_loan", { is_statutory: true }),
  T("pt-pagloan", "Pag-IBIG loan", "deduction", "pagibig_loan", { is_statutory: true }),
  T("pt-loan", "Company loan", "deduction", "company_loan"),
  T("pt-advance", "Cash advance", "deduction", "company_loan"),
  T("pt-hmo", "HMO dependent premium", "deduction", "insurance"),
  T("pt-coop", "Halden cooperative share", "deduction", "other_authorized", { description: "Voluntary savings in the employees' cooperative." }),
  T("pt-loss", "Loss or damage", "deduction", "loss_damage"),
];
const typeById = new Map(pay_item_types.map((t) => [t.id, t]));

const item = (id: string, employee_id: string, typeId: string, amount: number, extra: Partial<PayItem> = {}): PayItem => {
  const t = typeById.get(typeId)!;
  return {
    id, type_id: typeId, employee_id, direction: t.direction, category: t.category, de_minimis_kind: t.de_minimis_kind, label: t.name, amount,
    schedule: t.default_schedule, start_date: "2026-01-01", end_date: null, installments: null, authorization: null, created_by: "e10", created_at: "2026-01-05T09:00:00+08:00", ...extra,
  };
};
const pay_items: PayItem[] = [
  item("pi-laundry-e29", "e29", "pt-laundry", 250), // ₱500 a month: ₱100 over the ceiling
  item("pi-uniform-e22", "e22", "pt-uniform", 9000, { start_date: P1 }),
  item("pi-transpo-e13", "e13", "pt-transpo", 1500),
  item("pi-comm-e21", "e21", "pt-comm", 6500, { label: "Sales commission, October", start_date: P1 }),
  item("pi-reimb-e08", "e08", "pt-reimb", 2350, { label: "Client visit expenses", start_date: P1 }),
  item("pi-bonus-e19", "e19", "pt-bonus", 25000, { start_date: P0 }),
  item("pi-rice-e25", "e25", "pt-rice", 1000, { label: "Rice subsidy (part-time rate)" }), // overrides the company default
  item("pi-sssloan-e16", "e16", "pt-sssloan", 1100, { start_date: "2026-06-01", installments: 24 }),
  item("pi-pagloan-e32", "e32", "pt-pagloan", 950, { label: "Pag-IBIG multi-purpose loan", schedule: "second_cutoff", start_date: "2025-12-16", installments: 24 }),
  item("pi-loan-e13", "e13", "pt-loan", 2000, { label: "Company laptop loan", start_date: "2026-09-01", installments: 12, authorization: "Signed salary deduction authorization, Aug 28, 2026" }),
  item("pi-ins-e22", "e22", "pt-hmo", 900, { authorization: "HMO enrolment form with deduction consent" }),
  item("pi-coop-e19", "e19", "pt-coop", 500, { authorization: "Cooperative membership form, Mar 2, 2026" }),
  item("pi-adv-e25", "e25", "pt-advance", 1500, { start_date: P1, installments: 2 }), // no authorization on file yet
  item("pi-adv-e37", "e37", "pt-advance", 3000, { label: "Emergency cash advance", start_date: P1, installments: 2, authorization: "Signed authorization, Nov 14, 2026" }),
];

// ---- Leave ------------------------------------------------------------------------
// Statutory leave is the floor; Halden adds its own on top. Vacation leave (15 days) replaces service incentive leave.

const L = (id: string, name: string, extra: Partial<LeaveType>): LeaveType => ({
  id, name, statutory: false, legal_basis: null, legal_min_days: 0, days: 0, accrual: "annual", calendar_days: false, min_service_months: 0,
  paid: true, convertible: false, carry_over_max: 0, counts_as_sil: false, requires_document: null, who: null, description: null, active: true, ...extra,
});
const leave_types: LeaveType[] = [
  L("lt-vl", "Vacation leave", { days: 15, accrual: "monthly", min_service_months: 6, convertible: true, carry_over_max: 5, counts_as_sil: true, who: "Everyone after six months", description: "1.25 days a month. Up to 5 unused days roll over; the rest are paid in cash in the December 16–31 payroll. Replaces service incentive leave." }),
  L("lt-sl", "Sick leave", { days: 15, accrual: "monthly", min_service_months: 6, requires_document: "Medical certificate for two or more days in a row", who: "Everyone after six months" }),
  L("lt-bereave", "Bereavement leave", { days: 3, accrual: "per_event", requires_document: "Death certificate", who: "Death of a spouse, child, parent or sibling" }),
  L("lt-birthday", "Birthday leave", { days: 1, who: "Everyone, in their birthday month" }),
  L("lt-lwop", "Leave without pay", { days: 30, accrual: "per_event", paid: false, who: "Anyone, with manager approval", description: "Not paid, and not counted toward the 13th month." }),
  ...STATUTORY_LEAVES.map((t) => t.id === "lt-paternity" ? { ...t, days: 10, description: "Halden gives 10 days, 3 more than the law." } : t),
];

const LR = (id: string, employee_id: string, leave_type_id: string, start_date: string, end_date: string, status: LeaveRequest["status"], reason: string, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id, employee_id, leave_type_id, start_date, end_date, half_day: false, reason, status, filed_at: at(addDays(start_date, -10), "09:00"),
  decided_by: status === "pending" ? null : "e10", decided_at: status === "pending" ? null : at(addDays(start_date, -8), "10:00"), decision_note: null, ...extra,
});
const leave_requests: LeaveRequest[] = [
  LR("lv-1", "e08", "lt-vl", W(4), W(3), "approved", "Family trip to Bohol"),
  LR("lv-2", "e22", "lt-sl", W(2), W(2), "approved", "Dental procedure in the afternoon", { half_day: true }),
  LR("lv-3", "e29", "lt-lwop", W(7), W(7), "approved", "Moving house; I’ve used my vacation leave"),
  LR("lv-4", "e04", "lt-vl", "2026-08-10", "2026-08-14", "approved", "Vacation"),
  LR("lv-5", "e10", "lt-vl", "2026-04-27", "2026-04-30", "approved", "Holy Week extension"),
  LR("lv-6", "e19", "lt-vl", "2026-10-19", "2026-10-23", "rejected", "Trip to Japan", { decision_note: "That's the product launch week. Can you move it to November?" }),
  LR("lv-7", "e16", "lt-vl", "2026-12-21", "2026-12-23", "pending", "Christmas in Ilocos"),
  LR("lv-8", "e13", "lt-vl", "2026-12-28", "2026-12-29", "pending", "Year-end break"),
  LR("lv-9", "e21", "lt-bereave", addDays(TODAY_LOCAL, 3), addDays(TODAY_LOCAL, 5), "pending", "My grandmother’s wake and burial in Iloilo"),
];

const leave_adjustments: LeaveAdjustment[] = [
  { id: "la-1", employee_id: "e10", leave_type_id: "lt-vl", year: 2026, days: 2, note: "Five-year service award" },
  { id: "la-2", employee_id: "e13", leave_type_id: "lt-vl", year: 2025, days: 3, note: "Unused 2025 balance at go-live" },
];

// Year-to-date payroll before Halden went live on Nov 1, 2026 (from the previous payroll provider).
const payroll_openings: PayrollOpening[] = compensation.filter((c) => c.employee_id !== "e34" && c.employee_id !== "e37").map((c) => {
  const e = employees.find((x) => x.id === c.employee_id)!;
  const monthly = c.pay_basis === "monthly" ? c.rate : c.rate * 4 * 22;
  const k = monthlyContributions(monthly);
  const mandatory = (k.sssEe + k.phEe + k.pagEe) * 10;
  const basic = monthly * 10;
  const taxable = basic - mandatory;
  const tax = withholdingSemiMonthly(taxable / 20) * 20;
  return {
    employee_id: e.id, year: 2026, through_date: "2026-10-31", taxable_compensation: Math.round(taxable * 100) / 100,
    tax_withheld: Math.round(tax * 100) / 100, non_taxable_benefits: e.id === "e19" ? 42500 : 0, mandatory_contributions: Math.round(mandatory * 100) / 100,
    basic_pay: basic, thirteenth_paid: 0,
  };
});

export const seed: Database = {
  departments,
  locations,
  employees,
  employment_events,
  employee_documents,
  onboarding_template_tasks,
  onboarding_cases,
  onboarding_tasks,
  shift_codes,
  time_records: [...buildTimeRecords(SEED_NOW), ...correctionRecords],
  compensation,
  holidays,
  overtime_requests,
  correction_requests,
  payroll_periods,
  payroll_settings,
  employee_payroll_settings,
  pay_items,
  pay_item_types,
  leave_types,
  leave_requests,
  leave_adjustments,
  payroll_openings,
};
