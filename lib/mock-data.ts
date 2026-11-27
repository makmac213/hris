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
} from "./types";
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

// ---- Time records ------------------------------------------------------------
// Generated relative to the real current time so the attendance view always has a believable "today".

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

function recentWorkdays(nowIso: string, count: number): string[] {
  const today = zoned(nowIso).date;
  const days: string[] = [];
  let d = addDays(today, -1);
  while (days.length < count) {
    if (!isWeekend(d)) days.unshift(d);
    d = addDays(d, -1);
  }
  return isWeekend(today) ? days : [...days, today];
}

function buildTimeRecords(nowIso: string): TimeRecord[] {
  const now = Date.parse(nowIso);
  const out: TimeRecord[] = [];
  const days = recentWorkdays(nowIso, 4);
  const today = days[days.length - 1];

  for (const e of employees) {
    const shift = shift_codes.find((s) => s.id === e.shift_code_id);
    if (!shift || e.status === "offboarded" || e.status === "on_leave") continue;
    const gps = OFFICE_GPS[e.location_id ?? ""] ?? OFFICE_GPS["loc-mnl"];
    days.forEach((day, di) => {
      if (day < e.start_date) return;
      const r = (k: string) => rand(`${e.id}${day}${k}`);
      // Scripted exceptions so every status shows up.
      if (e.id === "e13" && di === 1) return; // absent one day
      if (e.id === "e32" && day === today) return; // hasn't clocked in today
      let inOffset = Math.round(-14 + r("in") * 16); // mostly 14 min early to 2 min late
      if (e.id === "e16" && (di === 0 || day === today)) inOffset = 18 + Math.round(r("late") * 10);
      if (e.id === "e27" && di === 2) inOffset = 34;
      let outOffset = Math.round(r("out") * 22);
      if (e.id === "e19" && di === 1) outOffset = -45;

      const startIso = localToIso(day, shift.start_time, shift.timezone);
      const inAt = Date.parse(startIso) + inOffset * 60000;
      const outAt = Date.parse(startIso) + (spanMinutes(shift) + outOffset) * 60000;
      const mk = (kind: TimeRecord["kind"], at: number): TimeRecord => ({
        id: `tr-${e.id}-${day}-${kind}`,
        organization_id: ORG_ID,
        employee_id: e.id,
        shift_code_id: shift.id,
        kind,
        recorded_at: new Date(at).toISOString(),
        work_date: day,
        photo_path: `mock:${e.id}`,
        latitude: +(gps[0] + (r(kind + "lat") - 0.5) * 0.0016).toFixed(6),
        longitude: +(gps[1] + (r(kind + "lng") - 0.5) * 0.0016).toFixed(6),
        accuracy_m: Math.round(6 + r(kind + "acc") * 30),
        device: DEVICES[Math.floor(r("dev") * DEVICES.length)],
      });
      if (inAt < now) out.push(mk("clock_in", inAt));
      if (outAt < now && !(e.id === "e12" && di === 2)) out.push(mk("clock_out", outAt)); // e12 forgot to clock out once
    });
  }
  return out;
}

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
  time_records: buildTimeRecords(SEED_NOW),
};
