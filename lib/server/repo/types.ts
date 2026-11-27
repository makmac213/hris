// Storage boundary. Services only talk to a Repository, so the same rules run on the in-memory store
// (development, tests) and on Supabase (production).

import type { Database, PayrollSettings, ScheduleSettings } from "@/lib/types";

/** Tables that hold rows. `payroll_settings` and `schedule_settings` are one object per organization, with their own methods. */
export type Table = { [K in keyof Database]: Database[K] extends unknown[] ? K : never }[keyof Database];
export type Row<T extends Table> = Database[T][number];

export type ApiScope =
  | "employees:read" | "employees:write" | "time:write" | "requests:read" | "requests:write"
  | "payroll:read" | "payroll:write" | "leave:read" | "schedule:read" | "schedule:write";

export interface ApiKey {
  id: string;
  organization_id: string;
  name: string;
  prefix: string; // first 12 characters, for display
  hash: string; // SHA-256 of the full key, hex
  scopes: ApiScope[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface StoredResponse { status: number; body: unknown; created_at: string }

export interface Repository {
  readonly kind: "memory" | "supabase";
  /** Every row the caller's organization can see. The engines (payroll, leave, tax) work on this snapshot. */
  snapshot(orgId: string): Promise<Database>;
  insert<T extends Table>(table: T, row: Row<T>): Promise<Row<T>>;
  /** Updates rows whose `key` column equals `value`. Returns the updated rows. */
  update<T extends Table>(table: T, key: keyof Row<T> & string, value: string, patch: Partial<Row<T>>): Promise<Row<T>[]>;
  /** Inserts rows, replacing any with the same id. */
  upsert<T extends Table>(table: T, rows: Row<T>[]): Promise<Row<T>[]>;
  /** Deletes rows whose `key` column is one of `values`. Returns how many went. */
  remove<T extends Table>(table: T, key: keyof Row<T> & string, values: string[]): Promise<number>;
  updateSettings(orgId: string, patch: Partial<PayrollSettings>): Promise<void>;
  updateScheduleSettings(orgId: string, patch: Partial<ScheduleSettings>): Promise<ScheduleSettings>;
  newId(prefix: string): string;

  findEmployeeByUser(userId: string): Promise<{ employeeId: string; orgId: string } | null>;
  findApiKey(hash: string): Promise<ApiKey | null>;
  touchApiKey(id: string, at: string): Promise<void>;

  getIdempotent(scope: string, key: string): Promise<StoredResponse | null>;
  putIdempotent(scope: string, key: string, res: StoredResponse): Promise<void>;
}
