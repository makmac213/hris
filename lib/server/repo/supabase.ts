// Supabase repository. Two ways in:
//  - a user's session: a client carrying their JWT, so row-level security decides what they see;
//  - an API key: the service-role client, scoped to the key's organization here in code.
// Not yet run against a live project: see docs/api.md, "Rollout".

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS } from "@/lib/payroll";
import type { Database, PayrollSettings } from "@/lib/types";
import type { ApiKey, Repository, Row, StoredResponse, Table } from "./types";

/** App table names that differ from the SQL schema. */
const SQL_NAME: Partial<Record<Table, string>> = { correction_requests: "time_correction_requests" };
const sqlName = (t: Table) => SQL_NAME[t] ?? t;

/** Tables with an organization_id column; the rest hang off an employee (or another org-scoped row). */
const ORG_TABLES: Table[] = ["departments", "locations", "employees", "shift_codes", "time_records", "holidays", "payroll_periods", "pay_item_types", "leave_types"];
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
