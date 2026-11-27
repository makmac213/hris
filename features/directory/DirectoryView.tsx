"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { indexById, today, useDb } from "@/lib/store";
import { displayName, formatDate, statusLabel } from "@/lib/format";
import type { Employee, EmploymentStatus } from "@/lib/types";
import { Button, EmptyState, FilterSelect, Icon, PersonCell, SearchInput, StatusBadge } from "@/components/ui";
import { AddEmployeeDialog } from "./AddEmployeeDialog";

type SortKey = "name" | "department" | "location" | "manager" | "start" | "status";

export function DirectoryView() {
  const db = useDb();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [loc, setLoc] = useState("");
  const [status, setStatus] = useState<EmploymentStatus | "">("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [adding, setAdding] = useState(false);

  const deps = useMemo(() => indexById(db.departments), [db.departments]);
  const locs = useMemo(() => indexById(db.locations), [db.locations]);
  const people = useMemo(() => indexById(db.employees), [db.employees]);

  const current = db.employees.filter((e) => e.status !== "offboarded");
  const startingSoon = db.employees.filter((e) => e.status === "onboarding" && e.start_date > today()).length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sortVal = (e: Employee): string => {
      switch (sort.key) {
        case "name": return displayName(e).toLowerCase();
        case "department": return deps.get(e.department_id ?? "")?.name ?? "";
        case "location": return locs.get(e.location_id ?? "")?.name ?? "";
        case "manager": { const m = people.get(e.manager_id ?? ""); return m ? displayName(m) : ""; }
        case "start": return e.start_date;
        case "status": return statusLabel[e.status];
      }
    };
    return db.employees
      .filter((e) => (status ? e.status === status : e.status !== "offboarded"))
      .filter((e) => !dept || e.department_id === dept)
      .filter((e) => !loc || e.location_id === loc)
      .filter((e) => {
        if (!needle) return true;
        const hay = [displayName(e), e.first_name, e.last_name, e.job_title, e.work_email, e.employee_number].join(" ").toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => sortVal(a).localeCompare(sortVal(b)) * sort.dir);
  }, [db.employees, q, dept, loc, status, sort, deps, locs, people]);

  const filtered = Boolean(q || dept || loc || status);
  const clear = () => { setQ(""); setDept(""); setLoc(""); setStatus(""); };

  const th = (k: SortKey, children: string, className = "") => {
    const active = sort.key === k;
    return (
      <th key={k} className={className} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className={`th-btn ${active ? "th-active" : ""}`} onClick={() => setSort({ key: k, dir: active ? (-sort.dir as 1 | -1) : 1 })}>
          {children}
          <Icon name={active ? "chevronDown" : "arrowUpDown"} size={14} className={active && sort.dir === -1 ? "flip" : ""} />
        </button>
      </th>
    );
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Employees</h1>
          <p className="muted">
            {current.length} people across {db.departments.length} teams
            {startingSoon > 0 && <> · <Link href="/onboarding" className="link">{startingSoon} starting soon</Link></>}
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add employee</Button>
      </header>

      <div className="toolbar" role="search">
        <SearchInput value={q} onChange={setQ} label="Search employees" placeholder="Search by name, title, email or ID" />
        <div className="filters">
          <FilterSelect label="Departments" value={dept} onChange={setDept} options={db.departments.map((d) => ({ value: d.id, label: d.name }))} />
          <FilterSelect label="Locations" value={loc} onChange={setLoc} options={db.locations.map((l) => ({ value: l.id, label: l.name }))} />
          <FilterSelect<EmploymentStatus>
            label="Status"
            allLabel="Current employees"
            value={status}
            onChange={setStatus}
            options={(["active", "onboarding", "on_leave", "offboarded"] as const).map((s) => ({ value: s, label: statusLabel[s] }))}
          />
        </div>
      </div>

      <div className="table-meta">
        <span aria-live="polite">{rows.length} {rows.length === 1 ? "result" : "results"}</span>
        {filtered && <button type="button" className="link" onClick={clear}>Clear filters</button>}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No one matches these filters"
          body={q ? `Nobody's name, title, email or ID contains “${q}”. Check the spelling or widen the filters.` : "Try another department, location or status."}
          action={<Button onClick={clear}>Clear filters</Button>}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {th("name", "Name")}
                {th("department", "Department", "col-md")}
                {th("location", "Location", "col-lg")}
                {th("manager", "Manager", "col-lg")}
                {th("start", "Start date", "col-md")}
                {th("status", "Status")}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const m = people.get(e.manager_id ?? "");
                return (
                  <tr key={e.id} className="row-link" onClick={(ev) => { if (!(ev.target as HTMLElement).closest("a")) router.push(`/employees/${e.id}`); }}>
                    <td>
                      <Link href={`/employees/${e.id}`} className="row-anchor">
                        <PersonCell person={e} sub={e.job_title} />
                      </Link>
                    </td>
                    <td className="col-md">{deps.get(e.department_id ?? "")?.name ?? "—"}</td>
                    <td className="col-lg">{locs.get(e.location_id ?? "")?.name ?? "—"}</td>
                    <td className="col-lg">{m ? displayName(m) : <span className="muted">No manager</span>}</td>
                    <td className="col-md num">{formatDate(e.start_date)}</td>
                    <td>{e.status === "active" ? <span className="muted">Active</span> : <StatusBadge status={e.status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddEmployeeDialog
          onClose={() => setAdding(false)}
          onCreated={(id) => { setAdding(false); router.push(`/onboarding/ob-${id}`); }}
        />
      )}
    </div>
  );
}
