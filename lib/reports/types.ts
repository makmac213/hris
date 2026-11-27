// The shape every report returns, so the web app, the API and CSV export treat them all the same way.

import type { AppRole, Database, Employee } from "../types";

export type Category = "hr" | "executive" | "payroll" | "audit";
export type ValueKind = "text" | "number" | "money" | "percent" | "date" | "datetime" | "minutes" | "hours" | "days";
export type FilterKey = "range" | "as_of" | "period" | "month" | "year" | "org" | "group_by" | "q";
export type GroupBy = "department" | "branch" | "client";

export interface ReportParams {
  from: string; to: string; as_of: string; period_id?: string; month: string; year: number;
  department_id?: string; location_id?: string; client_id?: string; group_by: GroupBy; q?: string;
}

export interface Column { key: string; label: string; kind: ValueKind }
export type Cell = string | number | null;
export interface Kpi { label: string; value: number | string; kind: ValueKind; note?: string }

export type Chart =
  | { kind: "line"; title: string; x: string[]; series: { name: string; values: number[] }[]; valueKind: ValueKind }
  | { kind: "columns"; title: string; x: string[]; series: { name: string; values: number[] }[]; valueKind: ValueKind }
  | { kind: "bars"; title: string; items: { label: string; value: number }[]; valueKind: ValueKind };

export interface ReportResult {
  columns: Column[];
  rows: Record<string, Cell>[];
  totals?: Record<string, Cell>;
  kpis?: Kpi[];
  charts?: Chart[];
  notes?: string[];
  /** What the numbers cover, in words: "Nov 1 to Nov 30, 2026 · Client Operations". */
  scope: string;
}

/** Who is asking. `team` limits people-based reports to a manager's direct reports. */
export interface Viewer {
  kind: "user" | "key";
  role: AppRole | null;
  employee: Employee | null;
  isManager: boolean;
}

export type Access = "all" | "team" | false;

export interface ReportDef {
  key: string;
  title: string;
  category: Category;
  description: string;
  filters: FilterKey[];
  sources?: { label: string; url: string }[];
  access: (v: Viewer) => Access;
  run: (db: Database, p: ReportParams, scope: (e: Employee) => boolean, nowIso: string) => ReportResult;
}
