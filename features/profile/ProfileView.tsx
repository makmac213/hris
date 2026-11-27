"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { caseSummary, directReports, indexById, reportingChain, today, updateEmployee, useCurrentUser, useDb } from "@/lib/store";
import { shiftHours } from "@/lib/time";
import { displayName, employmentTypeLabel, formatBytes, formatDate, legalName, statusLabel, tenure } from "@/lib/format";
import type { Employee, EmploymentStatus } from "@/lib/types";
import { PayTab } from "./PayTab";
import { EmploymentTerms, LeaveTab } from "./EmploymentTab";
import { Avatar, Button, Dialog, EmptyState, Field, Icon, PersonCell, Progress, StatusBadge } from "@/components/ui";

type Tab = "overview" | "employment" | "leave" | "documents" | "pay";

const eventLabel: Record<string, string> = {
  hired: "Joined", promotion: "Promoted", transfer: "Left the company", title_change: "Title changed",
  manager_change: "Manager changed", leave: "Started leave", return: "Returned from leave",
  regularized: "Became a regular employee", separated: "Last day",
};

export function ProfileView({ id }: { id: string }) {
  const db = useDb();
  const { canManage, employee: viewer } = useCurrentUser();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const deps = useMemo(() => indexById(db.departments), [db.departments]);
  const locs = useMemo(() => indexById(db.locations), [db.locations]);

  const e = db.employees.find((x) => x.id === id);
  if (!e) {
    return (
      <div className="page">
        <EmptyState
          title="We couldn’t find this employee"
          body="The link may be out of date, or their record was removed."
          action={<Link className="btn btn-secondary btn-md" href="/employees">Back to employees</Link>}
        />
      </div>
    );
  }

  const dept = deps.get(e.department_id ?? "");
  const loc = locs.get(e.location_id ?? "");
  const manager = db.employees.find((x) => x.id === e.manager_id);
  const reports = directReports(db, e.id);
  const chain = reportingChain(db, e.id);
  const kase = db.onboarding_cases.find((c) => c.employee_id === e.id && c.status === "in_progress");
  const summary = kase ? caseSummary(db, kase) : null;
  const events = db.employment_events.filter((ev) => ev.employee_id === e.id).sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  const docs = db.employee_documents.filter((d) => d.employee_id === e.id);
  const shift = db.shift_codes.find((s) => s.id === e.shift_code_id);
  const canSeeDocs = canManage || viewer.id === e.id;
  const onPh = db.compensation.some((c) => c.employee_id === e.id && c.on_ph_payroll);
  const localTime = loc && !loc.is_remote
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: loc.timezone }).format(new Date())
    : null;

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/employees">Employees</Link>
        <Icon name="chevronRight" size={14} />
        <span aria-current="page">{displayName(e)}</span>
      </nav>

      <header className="profile-head">
        <Avatar person={e} size={64} />
        <div className="profile-title">
          <h1>{displayName(e)}</h1>
          <p className="muted">
            {e.job_title}{dept && <> · {dept.name}</>}
          </p>
        </div>
        <div className="profile-actions">
          <StatusBadge status={e.status} />
          {canManage && <Button icon="pencil" onClick={() => setEditing(true)}>Edit details</Button>}
        </div>
      </header>

      {summary && canManage && (
        <section className="notice" aria-label="Onboarding progress">
          <div className="notice-text">
            <strong>{e.start_date > today() ? `Starts ${formatDate(e.start_date)}` : `Started ${formatDate(e.start_date)}`}</strong>
            <span className="muted">
              {summary.done} of {summary.tasks.length} onboarding tasks done
              {summary.overdue > 0 && <> · <span className="text-danger">{summary.overdue} overdue</span></>}
            </span>
          </div>
          <Progress value={summary.done} max={summary.tasks.length} label="Onboarding progress" />
          <Link href={`/onboarding/${summary.kase.id}`} className="btn btn-secondary btn-sm">Open checklist</Link>
        </section>
      )}

      <div className="tabs" role="tablist" aria-label="Profile sections">
        {(["overview", "employment", "leave", "documents", "pay"] as Tab[]).filter((t) => (t !== "documents" || canSeeDocs) && (t !== "pay" || canManage) && (t !== "leave" || (onPh && (canManage || viewer.id === e.id)))).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            className={tab === t ? "tab tab-on" : "tab"}
            onClick={() => setTab(t)}
          >
            {t === "overview" ? "Overview" : t === "employment" ? "Employment" : t === "leave" ? "Leave" : t === "pay" ? "Pay" : `Documents (${docs.length})`}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="profile-grid" role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
          <div className="stack-lg">
            <section className="panel">
              <h2>Job</h2>
              <dl className="dl">
                <div><dt>Employee ID</dt><dd className="num">{e.employee_number}</dd></div>
                <div><dt>Department</dt><dd>{dept?.name ?? "—"}</dd></div>
                <div><dt>Employment type</dt><dd>{employmentTypeLabel[e.employment_type]}</dd></div>
                <div><dt>Start date</dt><dd>{formatDate(e.start_date)} <span className="muted">· {tenure(e.start_date, today())}</span></dd></div>
                <div>
                  <dt>Shift code</dt>
                  <dd>
                    {shift ? <><span className="code">{shift.code}</span> <span className="muted num">· {shiftHours(shift)}</span></> : <span className="muted">Not assigned</span>}
                    {canManage && <> · <button type="button" className="link" onClick={() => setEditing(true)}>{shift ? "Change" : "Assign"}</button></>}
                  </dd>
                </div>
                {(e.client_id || db.clients.length > 0) && <div><dt>Client</dt><dd>{db.clients.find((c) => c.id === e.client_id)?.name ?? <span className="muted">Not on a client</span>}</dd></div>}
                <div><dt>Branch</dt><dd>{loc?.name ?? "—"}{localTime && <span className="muted" suppressHydrationWarning> · {localTime} local time</span>}</dd></div>
                {e.end_date && <div><dt>Last day</dt><dd>{formatDate(e.end_date)}</dd></div>}
              </dl>
            </section>
            <section className="panel">
              <h2>Contact</h2>
              <dl className="dl">
                <div><dt>Work email</dt><dd><a className="link" href={`mailto:${e.work_email}`}>{e.work_email}</a></dd></div>
                <div><dt>Phone</dt><dd className="num">{e.phone ?? <span className="muted">Not added</span>}</dd></div>
                <div><dt>Legal name</dt><dd>{legalName(e)}</dd></div>
                <div><dt>Pronouns</dt><dd>{e.pronouns ?? <span className="muted">Not shared</span>}</dd></div>
              </dl>
            </section>
          </div>

          <div className="stack-lg">
            <section className="panel">
              <div className="panel-head">
                <h2>Reporting line</h2>
                <Link href={`/org-chart?focus=${e.id}`} className="link">View in org chart</Link>
              </div>
              {chain.length === 0 ? (
                <p className="muted">Top of the organization.</p>
              ) : (
                <ol className="chain">
                  {chain.map((p) => (
                    <li key={p.id}>
                      <Link href={`/employees/${p.id}`} className="list-link"><PersonCell person={p} sub={p.job_title} /></Link>
                    </li>
                  ))}
                  <li className="chain-self"><PersonCell person={e} sub="This employee" /></li>
                </ol>
              )}
            </section>
            <section className="panel">
              <h2>Direct reports <span className="count">{reports.length}</span></h2>
              {reports.length === 0 ? (
                <p className="muted">No one reports to {e.preferred_name ?? e.first_name}.</p>
              ) : (
                <ul className="list">
                  {reports.map((r) => (
                    <li key={r.id}>
                      <Link href={`/employees/${r.id}`} className="list-link"><PersonCell person={r} sub={r.job_title} /></Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === "employment" && (
        <div className="stack-lg" role="tabpanel" id="panel-employment" aria-labelledby="tab-employment">
        {canManage && <EmploymentTerms employee={e} />}
        <section className="panel">
          <h2>History</h2>
          <ol className="timeline">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className="timeline-date num">{formatDate(ev.effective_date)}</span>
                <span className="timeline-body">
                  <strong>{eventLabel[ev.kind]}{ev.job_title && <> as {ev.job_title}</>}</strong>
                  {(ev.note || ev.department_id) && (
                    <span className="muted">{ev.note ?? deps.get(ev.department_id ?? "")?.name}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
        </div>
      )}

      {tab === "leave" && <LeaveTab employee={e} canAdjust={canManage} />}

      {tab === "pay" && canManage && <PayTab employee={e} />}

      {tab === "documents" && canSeeDocs && (
        <section className="panel panel-flush" role="tabpanel" id="panel-documents" aria-labelledby="tab-documents">
          <table className="table">
            <thead><tr><th>Name</th><th className="col-md">Category</th><th className="col-md">Uploaded</th><th className="num">Size</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td><span className="doc"><Icon name="file" size={18} />{d.name}</span></td>
                  <td className="col-md">{d.category[0].toUpperCase() + d.category.slice(1)}</td>
                  <td className="col-md num">{formatDate(d.uploaded_at)}</td>
                  <td className="num">{formatBytes(d.size_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {editing && <EditDialog employee={e} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const db = useDb();
  const [f, setF] = useState({
    preferred_name: employee.preferred_name ?? "",
    pronouns: employee.pronouns ?? "",
    job_title: employee.job_title,
    department_id: employee.department_id ?? "",
    location_id: employee.location_id ?? "",
    client_id: employee.client_id ?? "",
    manager_id: employee.manager_id ?? "",
    phone: employee.phone ?? "",
    status: employee.status,
    shift_code_id: employee.shift_code_id ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setError(""); };

  // Prevent cycles: you can't report to yourself or to anyone below you.
  const below = useMemo(() => {
    const out = new Set<string>([employee.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of db.employees) if (x.manager_id && out.has(x.manager_id) && !out.has(x.id)) { out.add(x.id); grew = true; }
    }
    return out;
  }, [db.employees, employee.id]);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!f.job_title.trim()) { setError("Enter a job title."); return; }
    updateEmployee(employee.id, {
      preferred_name: f.preferred_name.trim() || null,
      pronouns: f.pronouns.trim() || null,
      job_title: f.job_title.trim(),
      department_id: f.department_id || null,
      location_id: f.location_id || null,
      client_id: f.client_id || null,
      manager_id: f.manager_id || null,
      phone: f.phone.trim() || null,
      status: f.status,
      shift_code_id: f.shift_code_id || null,
    });
    onClose();
  };

  return (
    <Dialog
      title={`Edit ${displayName(employee)}`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="edit-employee">Save changes</Button></>}
    >
      <form id="edit-employee" className="form-grid" onSubmit={submit} noValidate>
        <div className="span-2">
          <Field label="Job title" error={error}>
            {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error} value={f.job_title} onChange={(e) => set("job_title", e.target.value)} />}
          </Field>
        </div>
        <Field label="Department">
          {(id) => (
            <select id={id} value={f.department_id} onChange={(e) => set("department_id", e.target.value)}>
              {db.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Manager" hint="People who report to them aren’t listed.">
          {(id, d) => (
            <select id={id} aria-describedby={d} value={f.manager_id} onChange={(e) => set("manager_id", e.target.value)}>
              <option value="">No manager</option>
              {db.employees.filter((x) => !below.has(x.id) && x.status !== "offboarded").map((x) => <option key={x.id} value={x.id}>{displayName(x)}</option>)}
            </select>
          )}
        </Field>
        <Field label="Branch">
          {(id) => (
            <select id={id} value={f.location_id} onChange={(e) => set("location_id", e.target.value)}>
              {db.locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </Field>
        {db.clients.length > 0 && (
          <Field label="Client">
            {(id) => (
              <select id={id} value={f.client_id} onChange={(e) => set("client_id", e.target.value)}>
                <option value="">Not on a client</option>
                {db.clients.filter((x) => !x.archived_at || x.id === f.client_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
          </Field>
        )}
        <Field label="Status">
          {(id) => (
            <select id={id} value={f.status} onChange={(e) => set("status", e.target.value as EmploymentStatus)}>
              {(Object.keys(statusLabel) as EmploymentStatus[]).map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
            </select>
          )}
        </Field>
        <div className="span-2">
          <Field label="Shift code" hint="Sets the hours their time records are checked against.">
            {(id, d) => (
              <select id={id} aria-describedby={d} value={f.shift_code_id} onChange={(e) => set("shift_code_id", e.target.value)}>
                <option value="">No shift code (time not tracked)</option>
                {db.shift_codes.filter((s) => !s.archived_at || s.id === f.shift_code_id).map((s) => (
                  <option key={s.id} value={s.id}>{s.code} · {shiftHours(s)}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Preferred name" hint="Shown across Halden instead of their first name.">
          {(id, d) => <input id={id} aria-describedby={d} value={f.preferred_name} onChange={(e) => set("preferred_name", e.target.value)} />}
        </Field>
        <Field label="Pronouns">
          {(id) => <input id={id} value={f.pronouns} onChange={(e) => set("pronouns", e.target.value)} />}
        </Field>
        <div className="span-2">
          <Field label="Phone">
            {(id) => <input id={id} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />}
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
