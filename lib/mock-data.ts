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
} from "./types";
import { DEFAULT_SETTINGS, periodFor } from "./payroll";
import { addDays } from "./format";
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
  { id: "loc-mnl", organization_id: ORG_ID, name: "Manila", city: "Makati", country_code: "PH", timezone: "Asia/Manila", is_remote: false },
  { id: "loc-sin", organization_id: ORG_ID, name: "Singapore", city: "Singapore", country_code: "SG", timezone: "Asia/Singapore", is_remote: false },
  { id: "loc-syd", organization_id: ORG_ID, name: "Sydney", city: "Sydney", country_code: "AU", timezone: "Australia/Sydney", is_remote: false },
  { id: "loc-sfo", organization_id: ORG_ID, name: "San Francisco", city: "San Francisco", country_code: "US", timezone: "America/Los_Angeles", is_remote: false },
  { id: "loc-remote", organization_id: ORG_ID, name: "Remote", city: null, country_code: null, timezone: "UTC", is_remote: true },
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
  ["e29", "Nathan", "Cruz", "Customer Success Manager", "dep-cs", "loc-mnl", "e28", "2023-09-04"],
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
const item = (id: string, employee_id: string, direction: PayItem["direction"], category: PayItem["category"], label: string, amount: number, extra: Partial<PayItem> = {}): PayItem => ({
  id, employee_id, direction, category, de_minimis_kind: null, label, amount, schedule: "every_cutoff", start_date: "2026-01-01",
  end_date: null, installments: null, authorization: null, created_by: "e10", created_at: "2026-01-05T09:00:00+08:00", ...extra,
});
const pay_items: PayItem[] = [
  // Rice subsidy for rank-and-file staff: ₱1,250 a cutoff, inside the ₱2,500 a month ceiling.
  ...["e08", "e13", "e16", "e19", "e21", "e22", "e25", "e29", "e32", "e34", "e37"].map((id) =>
    item(`pi-rice-${id}`, id, "earning", "de_minimis", "Rice subsidy", 1250, { de_minimis_kind: "rice" })),
  item("pi-laundry-e29", "e29", "earning", "de_minimis", "Laundry allowance", 250, { de_minimis_kind: "laundry" }), // ₱500 a month: ₱100 over
  item("pi-uniform-e22", "e22", "earning", "de_minimis", "Uniform allowance", 9000, { de_minimis_kind: "uniform", schedule: "once", start_date: P1 }),
  item("pi-transpo-e13", "e13", "earning", "taxable_allowance", "Transportation allowance", 1500),
  item("pi-comm-e21", "e21", "earning", "commission", "Sales commission, October", 6500, { schedule: "once", start_date: P1 }),
  item("pi-reimb-e08", "e08", "earning", "reimbursement", "Client visit expenses (receipts on file)", 2350, { schedule: "once", start_date: P1 }),
  item("pi-bonus-e19", "e19", "earning", "other_benefit", "Project completion bonus", 25000, { schedule: "once", start_date: P0 }),
  item("pi-sssloan-e16", "e16", "deduction", "sss_loan", "SSS salary loan", 1100, { start_date: "2026-06-01", installments: 24 }),
  item("pi-pagloan-e32", "e32", "deduction", "pagibig_loan", "Pag-IBIG multi-purpose loan", 950, { schedule: "second_cutoff", start_date: "2025-12-16", installments: 24 }),
  item("pi-loan-e13", "e13", "deduction", "company_loan", "Company laptop loan", 2000, { start_date: "2026-09-01", installments: 12, authorization: "Signed salary deduction authorization, Aug 28, 2026" }),
  item("pi-ins-e22", "e22", "deduction", "insurance", "HMO dependent premium", 900, { authorization: "HMO enrolment form with deduction consent" }),
  item("pi-adv-e25", "e25", "deduction", "other_authorized", "Cash advance repayment", 1500, { start_date: P1, installments: 2 }), // no authorization on file yet
  item("pi-adv-e37", "e37", "deduction", "company_loan", "Emergency cash advance", 3000, { start_date: P1, installments: 2, authorization: "Signed authorization, Nov 14, 2026" }),
];

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
};
