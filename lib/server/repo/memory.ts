// In-memory repository, seeded from the sample company. Used in development, tests and demos.
// One instance per server process; a restart resets it, like the prototype.

import { ORG_ID, seed } from "@/lib/mock-data";
import type { ApprovalSettings, AuditEntry, Database, PayrollSettings, ScheduleSettings } from "@/lib/types";
import type { ApiKey, Repository, Row, SettingsKey, StoredResponse, Table } from "./types";

export class MemoryRepository implements Repository {
  readonly kind = "memory" as const;
  private db: Database;
  private keys: ApiKey[] = [];
  private idem = new Map<string, StoredResponse>();
  private seq = 0;
  /** Supabase auth user id → employee id. In memory, an employee's id doubles as their user id. */
  constructor(initial: Database = seed) {
    this.db = structuredClone(initial);
  }

  async snapshot(orgId: string): Promise<Database> {
    if (orgId !== ORG_ID) throw new Error(`Unknown organization ${orgId}`);
    return this.db;
  }

  async insert<T extends Table>(table: T, row: Row<T>): Promise<Row<T>> {
    this.db = { ...this.db, [table]: [...(this.db[table] as Row<T>[]), row] };
    return row;
  }

  async update<T extends Table>(table: T, key: keyof Row<T> & string, value: string, patch: Partial<Row<T>>): Promise<Row<T>[]> {
    const changed: Row<T>[] = [];
    const rows = (this.db[table] as Row<T>[]).map((r) => {
      if ((r as unknown as Record<string, unknown>)[key] !== value) return r;
      const next = { ...r, ...patch };
      changed.push(next);
      return next;
    });
    this.db = { ...this.db, [table]: rows };
    return changed;
  }

  async upsert<T extends Table>(table: T, rows: Row<T>[]): Promise<Row<T>[]> {
    const ids = new Set(rows.map((r) => (r as { id: string }).id));
    this.db = { ...this.db, [table]: [...(this.db[table] as Row<T>[]).filter((r) => !ids.has((r as { id: string }).id)), ...rows] };
    return rows;
  }

  async remove<T extends Table>(table: T, key: keyof Row<T> & string, values: string[]): Promise<number> {
    const set = new Set(values);
    const before = (this.db[table] as Row<T>[]).length;
    const rows = (this.db[table] as Row<T>[]).filter((r) => !set.has((r as unknown as Record<string, string>)[key]));
    this.db = { ...this.db, [table]: rows };
    return before - rows.length;
  }

  async updateScheduleSettings(_orgId: string, patch: Partial<ScheduleSettings>) {
    this.db = { ...this.db, schedule_settings: { ...this.db.schedule_settings, ...patch } };
    return this.db.schedule_settings;
  }

  async appendAudit(_orgId: string, entries: AuditEntry[]) {
    if (entries.length) this.db = { ...this.db, audit_log: [...entries, ...this.db.audit_log] };
  }

  async updateApprovalSettings(_orgId: string, patch: Partial<ApprovalSettings>) {
    this.db = { ...this.db, approval_settings: { ...this.db.approval_settings, ...patch } };
    return this.db.approval_settings;
  }

  async putSettings<K extends SettingsKey>(_orgId: string, key: K, patch: Partial<Database[K]>): Promise<Database[K]> {
    this.db = { ...this.db, [key]: { ...this.db[key], ...patch } };
    return this.db[key];
  }

  async updateSettings(_orgId: string, patch: Partial<PayrollSettings>) {
    this.db = { ...this.db, payroll_settings: { ...this.db.payroll_settings, ...patch } };
  }

  newId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}${(++this.seq).toString(36)}`;
  }

  async findEmployeeByUser(userId: string) {
    const e = this.db.employees.find((x) => x.id === userId);
    return e ? { employeeId: e.id, orgId: e.organization_id } : null;
  }

  addApiKey(key: ApiKey) { this.keys.push(key); }
  async findApiKey(hash: string) { return this.keys.find((k) => k.hash === hash) ?? null; }
  async touchApiKey(id: string, at: string) { this.keys = this.keys.map((k) => (k.id === id ? { ...k, last_used_at: at } : k)); }

  async getIdempotent(scope: string, key: string) {
    const hit = this.idem.get(`${scope}:${key}`);
    if (!hit) return null;
    if (Date.now() - Date.parse(hit.created_at) > 24 * 3600 * 1000) { this.idem.delete(`${scope}:${key}`); return null; }
    return hit;
  }
  async putIdempotent(scope: string, key: string, res: StoredResponse) { this.idem.set(`${scope}:${key}`, res); }
}
