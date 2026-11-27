// Supabase repository. Two ways in:
//  - a user's session: a client carrying their JWT, so row-level security decides what they see;
//  - an API key: the service-role client, scoped to the key's organization here in code.
// Not yet run against a live project: see docs/api.md, "Rollout".

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS } from "@/lib/payroll";
import { DEFAULT_APPROVAL_SETTINGS } from "@/lib/approvals";
import type { ApprovalSettings, Database, PayrollSettings, ScheduleSettings } from "@/lib/types";
import { DEFAULT_SCHEDULE_SETTINGS } from "@/lib/schedule";
import type { ApiKey, Repository, Row, StoredResponse, Table } from "./types";

/** App table names that differ from the SQL schema. */
const SQL_NAME: Partial<Record<Table, string>> = { correction_requests: "time_correction_requests" };
const sqlName = (t: Table) => SQL_NAME[t] ?? t;

/** Tables with an organization_id column; the rest hang off an employee (or another org-scoped row). */
const ORG_TABLES: Table[] = ["departments", "locations", "clients", "employees", "shift_codes", "time_records", "holidays", "payroll_periods", "payslips", "pay_item_types", "audit_log", "leave_types", "shift_assignments", "notifications"];
const EMPLOYEE_TABLES: Table[] = [
  "employment_events", "employee_documents", "onboarding_cases", "compensation", "overtime_requests", "correction_requests",
  "employee_payroll_settings", "pay_items", "leave_requests", "leave_adjustments", "payroll_openings",
];
const OTHER_TABLES: Table[] = ["onboarding_template_tasks", "onboarding_tasks"];

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. See docs/api.md, "Configuration".`);
  return v;
}

export function serviceClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

export function userClient(accessToken: string): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  constructor(private sb: SupabaseClient, private scopeInCode: boolean) {}

  private async rows<T extends Table>(table: T, orgId: string): Promise<Row<T>[]> {
    let q = this.sb.from(sqlName(table)).select("*");
    if (this.scopeInCode && ORG_TABLES.includes(table)) q = q.eq("organization_id", orgId);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as Row<T>[];
  }

  async snapshot(orgId: string): Promise<Database> {
    const all = [...ORG_TABLES, ...EMPLOYEE_TABLES, ...OTHER_TABLES];
    const loaded = await Promise.all(all.map((t) => this.rows(t, orgId)));
    const db = Object.fromEntries(all.map((t, i) => [t, loaded[i]])) as unknown as Database;
    if (this.scopeInCode) {
      // The service role sees every organization: keep only rows that belong to this one.
      const ids = new Set(db.employees.map((e) => e.id));
      for (const t of EMPLOYEE_TABLES) (db as unknown as Record<string, { employee_id: string }[]>)[t] = (db[t] as unknown as { employee_id: string }[]).filter((r) => ids.has(r.employee_id));
      const cases = new Set(db.onboarding_cases.map((c) => c.id));
      db.onboarding_tasks = db.onboarding_tasks.filter((t) => cases.has(t.case_id));
    }
    const { data: settings } = await this.sb.from("payroll_settings").select("*").eq("organization_id", orgId).maybeSingle();
    db.payroll_settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) } as PayrollSettings;
    const { data: sched } = await this.sb.from("schedule_settings").select("horizon_days, short_notice_hours").eq("organization_id", orgId).maybeSingle();
    db.schedule_settings = { ...DEFAULT_SCHEDULE_SETTINGS, ...(sched ?? {}) } as ScheduleSettings;
    const { data: appr } = await this.sb.from("approval_settings").select("approver_roles").eq("organization_id", orgId).maybeSingle();
    db.approval_settings = { ...DEFAULT_APPROVAL_SETTINGS, ...(appr ?? {}) } as ApprovalSettings;
    return db;
  }

  async insert<T extends Table>(table: T, row: Row<T>): Promise<Row<T>> {
    const { data, error } = await this.sb.from(sqlName(table)).insert(row as never).select().single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as Row<T>;
  }

  async update<T extends Table>(table: T, key: keyof Row<T> & string, value: string, patch: Partial<Row<T>>): Promise<Row<T>[]> {
    const { data, error } = await this.sb.from(sqlName(table)).update(patch as never).eq(key as string, value).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as Row<T>[];
  }

  async upsert<T extends Table>(table: T, rows: Row<T>[]): Promise<Row<T>[]> {
    if (!rows.length) return [];
    const { data, error } = await this.sb.from(sqlName(table)).upsert(rows as never[]).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as Row<T>[];
  }

  async remove<T extends Table>(table: T, key: keyof Row<T> & string, values: string[]): Promise<number> {
    if (!values.length) return 0;
    const { count, error } = await this.sb.from(sqlName(table)).delete({ count: "exact" }).in(key as string, values);
    if (error) throw new Error(`${table}: ${error.message}`);
    return count ?? 0;
  }

  async updateScheduleSettings(orgId: string, patch: Partial<ScheduleSettings>) {
    const { data, error } = await this.sb.from("schedule_settings").upsert({ organization_id: orgId, ...patch } as never).select("horizon_days, short_notice_hours").single();
    if (error) throw new Error(`schedule_settings: ${error.message}`);
    return { ...DEFAULT_SCHEDULE_SETTINGS, ...(data as Partial<ScheduleSettings>) };
  }

  async appendAudit() {
    // The audit trigger on each table writes the log in the same transaction (migration 0010).
  }

  async updateApprovalSettings(orgId: string, patch: Partial<ApprovalSettings>) {
    const { data, error } = await this.sb.from("approval_settings").upsert({ organization_id: orgId, ...patch } as never).select("approver_roles").single();
    if (error) throw new Error(`approval_settings: ${error.message}`);
    return { ...DEFAULT_APPROVAL_SETTINGS, ...(data as Partial<ApprovalSettings>) };
  }

  async updateSettings(orgId: string, patch: Partial<PayrollSettings>) {
    const { error } = await this.sb.from("payroll_settings").upsert({ organization_id: orgId, ...patch } as never);
    if (error) throw new Error(`payroll_settings: ${error.message}`);
  }

  newId() { return crypto.randomUUID(); }

  async findEmployeeByUser(userId: string) {
    const { data } = await this.sb.from("employees").select("id, organization_id").eq("user_id", userId).maybeSingle();
    return data ? { employeeId: data.id as string, orgId: data.organization_id as string } : null;
  }

  async findApiKey(hash: string) {
    const { data } = await this.sb.from("api_keys").select("*").eq("hash", hash).maybeSingle();
    return (data as ApiKey | null) ?? null;
  }

  async touchApiKey(id: string, at: string) {
    await this.sb.from("api_keys").update({ last_used_at: at }).eq("id", id);
  }

  async getIdempotent(scope: string, key: string) {
    const { data } = await this.sb.from("api_idempotency").select("status, body, created_at").eq("scope", scope).eq("key", key)
      .gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()).maybeSingle();
    return (data as StoredResponse | null) ?? null;
  }

  async putIdempotent(scope: string, key: string, res: StoredResponse) {
    await this.sb.from("api_idempotency").upsert({ scope, key, ...res } as never);
  }
}
