"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { archiveClient, assignPeople, deleteOrgUnit, saveBranch, saveClient, saveDepartment, useCurrentUser, useDb } from "@/lib/store";
import { displayName } from "@/lib/format";
import { REGIONAL_WAGES } from "@/lib/regions";
import type { Client, Department, Employee, Location, PhRegion } from "@/lib/types";
import { Button, Dialog, EmptyState, Field, Icon, PersonCell, SearchInput } from "@/components/ui";

type Tab = "departments" | "branches" | "clients";
type Field3 = "department_id" | "location_id" | "client_id";
const FIELD: Record<Tab, Field3> = { departments: "department_id", branches: "location_id", clients: "client_id" };
const NOUN: Record<Tab, string> = { departments: "department", branches: "branch", clients: "client" };

type Unit = { id: string; name: string };
type Editing = { tab: Tab; row: Department | Location | Client | null };

export function OrganizationView() {
  const db = useDb();
  const { canManage } = useCurrentUser();
  const [tab, setTab] = useState<Tab>("departments");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [assigning, setAssigning] = useState<{ tab: Tab; unit: Unit } | null>(null);
  const [note, setNote] = useState<{ text: string; warn?: boolean } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(() => db.employees.filter((e) => e.status !== "offboarded"), [db.employees]);
  const count = (field: Field3, id: string) => active.filter((e) => e[field] === id).length;
  const unassigned = (field: Field3) => active.filter((e) => !e[field]).length;
  const byId = new Map(db.employees.map((e) => [e.id, e]));

  if (!canManage) {
    return <div className="page"><EmptyState title="Only admins and HR can change the organization" body="Departments, branches and clients are on each person’s profile." action={<Link href="/employees" className="btn btn-secondary btn-md">Go to Employees</Link>} /></div>;
  }

  const clients = db.clients.filter((c) => showArchived || !c.archived_at);
  const archivedClients = db.clients.filter((c) => c.archived_at).length;
  const tabs: [Tab, string, number][] = [["departments", "Departments", db.departments.length], ["branches", "Branches", db.locations.length], ["clients", "Clients", db.clients.filter((c) => !c.archived_at).length]];

  const remove = (kind: "department" | "branch", u: Unit) => {
    const why = deleteOrgUnit(kind, u.id);
    setNote(why ? { text: `${u.name} wasn’t deleted. ${why}`, warn: true } : { text: `${u.name} deleted.` });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Organization</h1>
          <p className="muted">Departments, branches and client accounts. Each person belongs to one department and one branch, and can be on one client.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditing({ tab, row: null })}>Add {NOUN[tab]}</Button>
      </header>

      {note && (
        <div className={`toast ${note.warn ? "toast-warn" : ""}`} role="status">
          <Icon name={note.warn ? "alert" : "check"} size={18} /><span>{note.text}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNote(null)}><Icon name="x" size={16} /></button>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Organization">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>
            {label} <span className="count">{n}</span>
          </button>
        ))}
      </div>

      {unassigned(FIELD[tab]) > 0 && tab !== "clients" && (
        <p className="callout-warn small org-unassigned">{unassigned(FIELD[tab])} {unassigned(FIELD[tab]) === 1 ? "person has" : "people have"} no {NOUN[tab]}.</p>
      )}

      {tab === "departments" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Department</th><th className="col-md">Head</th><th className="num">People</th><th className="actions-cell"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {[...db.departments].sort((a, b) => a.name.localeCompare(b.name)).map((d) => {
                const head = d.head_id ? byId.get(d.head_id) : undefined;
                return (
                  <tr key={d.id}>
                    <td><strong>{d.name}</strong></td>
                    <td className="col-md">{head ? displayName(head) : <span className="muted">No head</span>}</td>
                    <td className="num">{count("department_id", d.id)}</td>
                    <td className="actions-cell"><RowActions onEdit={() => setEditing({ tab, row: d })} onAssign={() => setAssigning({ tab, unit: d })} onDelete={() => remove("department", d)} deleteLabel="Delete" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "branches" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Branch</th><th className="col-md">Where</th><th className="col-lg">Time zone</th><th className="num">People</th><th className="actions-cell"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {db.locations.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.name}</strong>{l.ph_region && <span className="cell-sub">Region {l.ph_region} minimum wage</span>}</td>
                  <td className="col-md">{l.is_remote ? <span className="muted">Remote</span> : [l.city, l.country_code].filter(Boolean).join(", ")}</td>
                  <td className="col-lg muted">{l.timezone}</td>
                  <td className="num">{count("location_id", l.id)}</td>
                  <td className="actions-cell"><RowActions onEdit={() => setEditing({ tab, row: l })} onAssign={() => setAssigning({ tab, unit: l })} onDelete={() => remove("branch", l)} deleteLabel="Delete" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "clients" && (
        clients.length === 0 ? (
          <EmptyState title="No clients yet" body="Add the client accounts your teams work on. People on an account can then be filtered on the schedule." action={<Button variant="primary" icon="plus" onClick={() => setEditing({ tab, row: null })}>Add client</Button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Client</th><th className="col-md">Industry</th><th className="num">People</th><th className="actions-cell"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id} className={c.archived_at ? "row-archived" : ""}>
                      <td><strong>{c.name}</strong> <span className="code">{c.code}</span>{c.archived_at && <span className="st-tag">Archived</span>}</td>
                      <td className="col-md">{c.industry ?? <span className="muted">—</span>}</td>
                      <td className="num">{count("client_id", c.id)}</td>
                      <td className="actions-cell">
                        {c.archived_at
                          ? <Button size="sm" variant="ghost" onClick={() => { archiveClient(c.id, false); setNote({ text: `${c.name} restored.` }); }}>Restore</Button>
                          : <RowActions onEdit={() => setEditing({ tab, row: c })} onAssign={() => setAssigning({ tab, unit: c })} onDelete={() => { const n = count("client_id", c.id); archiveClient(c.id, true); setNote({ text: `${c.name} archived${n ? `. ${n} ${n === 1 ? "person was" : "people were"} taken off the account` : ""}.` }); }} deleteLabel="Archive" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {archivedClients > 0 && (
              <button type="button" className="link archived-toggle" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? "Hide archived clients" : `Show ${archivedClients} archived`}
              </button>
            )}
          </>
        )
      )}

      {editing?.tab === "departments" && <DepartmentDialog row={editing.row as Department | null} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); setNote({ text: t }); }} />}
      {editing?.tab === "branches" && <BranchDialog row={editing.row as Location | null} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); setNote({ text: t }); }} />}
      {editing?.tab === "clients" && <ClientDialog row={editing.row as Client | null} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); setNote({ text: t }); }} />}
      {assigning && <AssignPeopleDialog tab={assigning.tab} unit={assigning.unit} onClose={() => setAssigning(null)} onDone={(t) => { setAssigning(null); setNote({ text: t }); }} />}
    </div>
  );
}

function RowActions({ onEdit, onAssign, onDelete, deleteLabel }: { onEdit: () => void; onAssign: () => void; onDelete: () => void; deleteLabel: string }) {
  return (
    <span className="row-actions">
      <Button size="sm" variant="ghost" onClick={onAssign}>Assign people</Button>
      <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
      <Button size="sm" variant="ghost" onClick={onDelete}>{deleteLabel}</Button>
    </span>
  );
}

// ---- Edit dialogs ---------------------------------------------------------------------

function DepartmentDialog({ row, onClose, onDone }: { row: Department | null; onClose: () => void; onDone: (msg: string) => void }) {
  const db = useDb();
  const [name, setName] = useState(row?.name ?? "");
  const [head, setHead] = useState(row?.head_id ?? "");
  const [err, setErr] = useState("");
  const people = db.employees.filter((e) => e.status !== "offboarded").sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const save = () => {
    const n = name.trim();
    if (!n) return setErr("Give the department a name.");
    if (db.departments.some((d) => d.id !== row?.id && d.name.toLowerCase() === n.toLowerCase())) return setErr(`There’s already a ${n} department.`);
    saveDepartment({ id: row?.id, name: n, head_id: head || null });
    onDone(row ? `${n} saved.` : `${n} added. Assign people to it next.`);
  };
  return (
    <Dialog title={row ? `Edit ${row.name}` : "Add department"} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{row ? "Save" : "Add department"}</Button></>}>
      <div className="form-grid">
        <Field label="Name" error={err}>{(id, d) => <input id={id} aria-describedby={d} value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />}</Field>
        <Field label="Head" hint="Shown on the org chart. Optional.">{(id, d) => (
          <select id={id} aria-describedby={d} value={head} onChange={(e) => setHead(e.target.value)}>
            <option value="">No head</option>
            {people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}, {p.job_title}</option>)}
          </select>
        )}</Field>
      </div>
    </Dialog>
  );
}

const TIMEZONES = ["Asia/Manila", "Asia/Singapore", "Australia/Sydney", "America/Los_Angeles", "America/New_York", "Europe/London", "UTC"];

function BranchDialog({ row, onClose, onDone }: { row: Location | null; onClose: () => void; onDone: (msg: string) => void }) {
  const db = useDb();
  const [f, setF] = useState({ name: row?.name ?? "", city: row?.city ?? "", country_code: row?.country_code ?? "PH", timezone: row?.timezone ?? "Asia/Manila", is_remote: row?.is_remote ?? false, ph_region: (row ? row.ph_region : "NCR") as PhRegion | null });
  const [err, setErr] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF({ ...f, [k]: v }); setErr(""); };
  const ph = f.country_code.toUpperCase() === "PH" && !f.is_remote;
  const save = () => {
    const n = f.name.trim();
    if (!n) return setErr("Give the branch a name.");
    if (db.locations.some((l) => l.id !== row?.id && l.name.toLowerCase() === n.toLowerCase())) return setErr(`There’s already a ${n} branch.`);
    saveBranch({ id: row?.id, name: n, city: f.is_remote ? null : f.city.trim() || null, country_code: f.is_remote ? null : f.country_code.trim().toUpperCase() || null, timezone: f.timezone, is_remote: f.is_remote, ph_region: ph ? f.ph_region ?? "NCR" : null });
    onDone(row ? `${n} saved.` : `${n} added.`);
  };
  return (
    <Dialog title={row ? `Edit ${row.name}` : "Add branch"} description="A branch is an office or site. Philippine branches set the regional minimum wage for the people there." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{row ? "Save" : "Add branch"}</Button></>}>
      <div className="form-grid">
        <Field label="Name" error={err}>{(id, d) => <input id={id} aria-describedby={d} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Davao" />}</Field>
        <label className="toggle-inline"><input type="checkbox" checked={f.is_remote} onChange={(e) => set("is_remote", e.target.checked)} /> People here work remotely</label>
        {!f.is_remote && <>
          <Field label="City">{(id) => <input id={id} value={f.city} onChange={(e) => set("city", e.target.value)} />}</Field>
          <Field label="Country code" hint="Two letters, e.g. PH">{(id, d) => <input id={id} aria-describedby={d} maxLength={2} value={f.country_code} onChange={(e) => set("country_code", e.target.value)} />}</Field>
        </>}
        {ph && (
          <Field label="Region" hint="For the regional minimum wage">{(id, d) => (
            <select id={id} aria-describedby={d} value={f.ph_region ?? "NCR"} onChange={(e) => set("ph_region", e.target.value as PhRegion)}>
              {REGIONAL_WAGES.map((r) => <option key={r.region} value={r.region}>{r.region}, {r.name}</option>)}
            </select>
          )}</Field>
        )}
        <Field label="Time zone">{(id) => (
          <select id={id} value={f.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {Array.from(new Set([f.timezone, ...TIMEZONES])).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}</Field>
      </div>
    </Dialog>
  );
}

function ClientDialog({ row, onClose, onDone }: { row: Client | null; onClose: () => void; onDone: (msg: string) => void }) {
  const db = useDb();
  const [f, setF] = useState({ name: row?.name ?? "", code: row?.code ?? "", industry: row?.industry ?? "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setErrs({}); };
  const save = () => {
    const e: Record<string, string> = {};
    const name = f.name.trim(), code = f.code.trim().toUpperCase();
    if (!name) e.name = "Give the client a name.";
    if (!/^[A-Z0-9]{2,6}$/.test(code)) e.code = "2 to 6 letters or digits, e.g. NWM.";
    else if (db.clients.some((c) => c.id !== row?.id && c.code === code)) e.code = `${code} is already used.`;
    if (Object.keys(e).length) return setErrs(e);
    saveClient({ id: row?.id, name, code, industry: f.industry.trim() || null });
    onDone(row ? `${name} saved.` : `${name} added. Assign the people on the account next.`);
  };
  return (
    <Dialog title={row ? `Edit ${row.name}` : "Add client"} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{row ? "Save" : "Add client"}</Button></>}>
      <div className="form-grid">
        <Field label="Name" error={errs.name}>{(id, d) => <input id={id} aria-describedby={d} value={f.name} onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label="Short code" hint="Shown on the schedule." error={errs.code}>{(id, d) => <input id={id} aria-describedby={d} value={f.code} maxLength={6} onChange={(e) => set("code", e.target.value)} />}</Field>
        <Field label="Industry" hint="Optional">{(id, d) => <input id={id} aria-describedby={d} value={f.industry} onChange={(e) => set("industry", e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

// ---- Assign people ------------------------------------------------------------------

function AssignPeopleDialog({ tab, unit, onClose, onDone }: { tab: Tab; unit: Unit; onClose: () => void; onDone: (msg: string) => void }) {
  const db = useDb();
  const field = FIELD[tab];
  const [q, setQ] = useState("");
  const people = db.employees.filter((e) => e.status !== "offboarded");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(people.filter((e) => e[field] === unit.id).map((e) => e.id)));
  const nameOf = (e: Employee) => {
    const id = e[field];
    if (!id) return null;
    return tab === "departments" ? db.departments.find((d) => d.id === id)?.name : tab === "branches" ? db.locations.find((l) => l.id === id)?.name : db.clients.find((c) => c.id === id)?.name;
  };
  const list = people
    .filter((e) => `${displayName(e)} ${e.job_title}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(b[field] === unit.id) - Number(a[field] === unit.id) || displayName(a).localeCompare(displayName(b)));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const added = people.filter((e) => picked.has(e.id) && e[field] !== unit.id);
  const removed = people.filter((e) => !picked.has(e.id) && e[field] === unit.id);
  // People must stay in some department and branch, so unticking only works for clients.
  const canRemove = tab === "clients";
  const changes = added.length + (canRemove ? removed.length : 0);

  return (
    <Dialog
      title={`Assign people to ${unit.name}`}
      description={canRemove ? "Untick someone to take them off the account." : `Ticking someone moves them here from their current ${NOUN[tab]}. To move someone out, assign them to another ${NOUN[tab]}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!changes} onClick={() => {
            assignPeople(field, unit.id, added.map((e) => e.id));
            if (canRemove) assignPeople(field, null, removed.map((e) => e.id));
            onDone(`${unit.name}: ${added.length ? `${added.length} added` : ""}${added.length && canRemove && removed.length ? ", " : ""}${canRemove && removed.length ? `${removed.length} removed` : ""}.`);
          }}>
            Save {changes ? `${changes} ${changes === 1 ? "change" : "changes"}` : ""}
          </Button>
        </>
      }
    >
      <div className="stack-md">
        <SearchInput value={q} onChange={setQ} label="Search people" placeholder="Search people" />
        <ul className="pick-list">
          {list.map((e) => {
            const current = nameOf(e);
            const locked = !canRemove && e[field] === unit.id;
            return (
              <li key={e.id}>
                <label className="pick">
                  <input type="checkbox" checked={picked.has(e.id)} disabled={locked} onChange={() => toggle(e.id)} />
                  <span className="box" aria-hidden="true"><Icon name="check" size={14} /></span>
                  <PersonCell person={e} sub={e.job_title} />
                  <span className="pick-meta muted">{e[field] === unit.id ? "Here now" : current ?? `No ${NOUN[tab]}`}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
