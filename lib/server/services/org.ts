// Departments, branches (locations) and client accounts, and moving people between them.

import { z } from "zod";
import type { Client, Department, Employee, Location } from "@/lib/types";
import { type Ctx, requirePrivileged, requireScope } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { parse } from "../validate";

const REGIONS = ["NCR", "CAR", "I", "II", "III", "IV-A", "IV-B", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "BARMM"] as const;
const active = (e: Employee) => e.status !== "offboarded";

// ---- Departments -------------------------------------------------------------------

export async function listDepartments(ctx: Ctx) {
  requireScope(ctx, "employees:read");
  const db = await ctx.repo.snapshot(ctx.orgId);
  return { data: db.departments.map((d) => ({ ...d, people: db.employees.filter((e) => active(e) && e.department_id === d.id).length })) };
}

export const SaveDepartment = z.object({ name: z.string().trim().min(1, "Give the department a name."), head_id: z.string().nullable().default(null) });
export async function createDepartment(ctx: Ctx, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const input = parse(SaveDepartment, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  checkDepartment(db.departments, db.employees, input, null);
  const row: Department = { id: ctx.repo.newId("dep"), organization_id: ctx.orgId, ...input };
  return ctx.repo.insert("departments", row);
}
export async function updateDepartment(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const patch = parse(SaveDepartment.partial().strict(), body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const cur = db.departments.find((d) => d.id === id);
  if (!cur) throw notFound("Department");
  checkDepartment(db.departments, db.employees, { ...cur, ...patch }, id);
  const [row] = await ctx.repo.update("departments", "id", id, patch);
  return row;
}
function checkDepartment(all: Department[], people: Employee[], d: { name: string; head_id: string | null }, id: string | null) {
  if (all.some((x) => x.id !== id && x.name.toLowerCase() === d.name.trim().toLowerCase())) throw invalid({ name: `There's already a ${d.name} department.` });
  if (d.head_id && !people.some((e) => e.id === d.head_id && active(e))) throw invalid({ head_id: "Unknown employee." });
}

// ---- Branches ----------------------------------------------------------------------

export async function listBranches(ctx: Ctx) {
  requireScope(ctx, "employees:read");
  const db = await ctx.repo.snapshot(ctx.orgId);
  return { data: db.locations.map((l) => ({ ...l, people: db.employees.filter((e) => active(e) && e.location_id === l.id).length })) };
}

export const SaveBranch = z.object({
  name: z.string().trim().min(1, "Give the branch a name."),
  city: z.string().trim().nullable().default(null),
  country_code: z.string().trim().length(2, "Two letters, like PH.").transform((s) => s.toUpperCase()).nullable().default(null),
  timezone: z.string().default("Asia/Manila"),
  is_remote: z.boolean().default(false),
  ph_region: z.enum(REGIONS).nullable().default(null),
});
function checkBranch(all: Location[], b: z.infer<typeof SaveBranch>, id: string | null) {
  if (all.some((x) => x.id !== id && x.name.toLowerCase() === b.name.toLowerCase())) throw invalid({ name: `There's already a ${b.name} branch.` });
  try { new Intl.DateTimeFormat("en-US", { timeZone: b.timezone }); } catch { throw invalid({ timezone: "Not an IANA time zone, like Asia/Manila." }); }
  if (b.ph_region && b.country_code !== "PH") throw invalid({ ph_region: "A region applies to branches in the Philippines (country_code PH)." });
  if (b.country_code === "PH" && !b.is_remote && !b.ph_region) throw invalid({ ph_region: "Philippine branches need a region for the minimum wage." });
}
export async function createBranch(ctx: Ctx, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const input = parse(SaveBranch, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  checkBranch(db.locations, input, null);
  const row: Location = { id: ctx.repo.newId("loc"), organization_id: ctx.orgId, ...input };
  return ctx.repo.insert("locations", row);
}
export async function updateBranch(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const patch = parse(SaveBranch.partial().strict(), body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const cur = db.locations.find((l) => l.id === id);
  if (!cur) throw notFound("Branch");
  checkBranch(db.locations, { ...cur, ...patch } as z.infer<typeof SaveBranch>, id);
  const [row] = await ctx.repo.update("locations", "id", id, patch as Partial<Location>);
  return row;
}

/** Deletes a department or branch nobody (current or former) is in. */
export async function removeUnit(ctx: Ctx, kind: "department" | "branch", id: string) {
  requirePrivileged(ctx, "employees:write");
  const db = await ctx.repo.snapshot(ctx.orgId);
  const exists = kind === "department" ? db.departments.some((d) => d.id === id) : db.locations.some((l) => l.id === id);
  if (!exists) throw notFound(kind === "department" ? "Department" : "Branch");
  const n = db.employees.filter((e) => (kind === "department" ? e.department_id : e.location_id) === id).length;
  if (n) throw conflict(`${n} ${n === 1 ? "person is" : "people are"} still assigned here, including former staff. Move them first.`);
  await ctx.repo.remove(kind === "department" ? "departments" : "locations", "id", [id]);
  return { deleted: id };
}

// ---- Clients -----------------------------------------------------------------------

export async function listClients(ctx: Ctx, query: Record<string, string>) {
  requireScope(ctx, "employees:read");
  const db = await ctx.repo.snapshot(ctx.orgId);
  const all = query.include_archived === "true";
  return { data: db.clients.filter((c) => all || !c.archived_at).map((c) => ({ ...c, people: db.employees.filter((e) => active(e) && e.client_id === c.id).length })) };
}

export const SaveClient = z.object({
  name: z.string().trim().min(1, "Give the client a name."),
  code: z.string().trim().regex(/^[A-Za-z0-9]{2,6}$/, "2 to 6 letters or digits.").transform((s) => s.toUpperCase()),
  industry: z.string().trim().nullable().default(null),
});
export async function createClient(ctx: Ctx, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const input = parse(SaveClient, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  if (db.clients.some((c) => c.code === input.code)) throw invalid({ code: `${input.code} is already used.` });
  const row: Client = { id: ctx.repo.newId("cl"), organization_id: ctx.orgId, ...input, archived_at: null };
  return ctx.repo.insert("clients", row);
}
export const UpdateClient = SaveClient.partial().extend({ archived: z.boolean().optional() }).strict();
export async function updateClient(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const { archived, ...patch } = parse(UpdateClient, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  if (!db.clients.some((c) => c.id === id)) throw notFound("Client");
  if (patch.code && db.clients.some((c) => c.id !== id && c.code === patch.code)) throw invalid({ code: `${patch.code} is already used.` });
  const changes: Partial<Client> = { ...patch, ...(archived === undefined ? {} : { archived_at: archived ? ctx.now : null }) };
  const [row] = await ctx.repo.update("clients", "id", id, changes);
  // Archiving takes everyone off the account.
  if (archived) await ctx.repo.update("employees", "client_id", id, { client_id: null });
  return row;
}

// ---- Moving people -----------------------------------------------------------------

export const Assign = z.object({ employee_ids: z.array(z.string()).min(1).max(500) });
/** Puts people in a department, branch or client. A department move is logged as a transfer. */
export async function assignTo(ctx: Ctx, kind: "department" | "branch" | "client", id: string, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const { employee_ids } = parse(Assign, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  const unit = kind === "department" ? db.departments.find((d) => d.id === id) : kind === "branch" ? db.locations.find((l) => l.id === id) : db.clients.find((c) => c.id === id && !c.archived_at);
  if (!unit) throw notFound(kind === "department" ? "Department" : kind === "branch" ? "Branch" : "Client");
  const unknown = employee_ids.filter((x) => !db.employees.some((e) => e.id === x && active(e)));
  if (unknown.length) throw invalid({ employee_ids: `Unknown or former employees: ${unknown.join(", ")}.` });
  const field = kind === "department" ? "department_id" : kind === "branch" ? "location_id" : "client_id";
  let moved = 0;
  for (const eid of employee_ids) {
    const e = db.employees.find((x) => x.id === eid)!;
    if (e[field] === id) continue;
    await ctx.repo.update("employees", "id", eid, { [field]: id } as Partial<Employee>);
    if (kind === "department") {
      await ctx.repo.insert("employment_events", { id: ctx.repo.newId("ev"), employee_id: eid, effective_date: ctx.now.slice(0, 10), kind: "transfer", job_title: e.job_title, department_id: id, note: `Moved to ${unit.name}` });
    }
    moved++;
  }
  return { moved, unchanged: employee_ids.length - moved };
}

/** Takes people off a client. Departments and branches can't be emptied this way: everyone belongs to one. */
export async function unassignClient(ctx: Ctx, id: string, body: unknown) {
  requirePrivileged(ctx, "employees:write");
  const { employee_ids } = parse(Assign, body);
  const db = await ctx.repo.snapshot(ctx.orgId);
  if (!db.clients.some((c) => c.id === id)) throw notFound("Client");
  let removed = 0;
  for (const eid of employee_ids) {
    if (db.employees.find((e) => e.id === eid)?.client_id !== id) continue;
    await ctx.repo.update("employees", "id", eid, { client_id: null });
    removed++;
  }
  return { removed };
}
