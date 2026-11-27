"use client";

import Link from "next/link";
import { useState } from "react";
import { caseSummary, setBuddy, setTaskDone, today, useDb } from "@/lib/store";
import { daysBetween, displayName, formatDate, ownerLabel, phaseLabel } from "@/lib/format";
import type { OnboardingPhase, TaskOwnerRole } from "@/lib/types";
import { Avatar, EmptyState, Icon, PersonCell, Progress } from "@/components/ui";

const PHASES: OnboardingPhase[] = ["before_start", "first_day", "first_week", "first_90_days"];

export function OnboardingCaseView({ id }: { id: string }) {
  const db = useDb();
  const [owner, setOwner] = useState<TaskOwnerRole | "all">("all");
  const kase = db.onboarding_cases.find((c) => c.id === id);
  const s = kase ? caseSummary(db, kase) : null;

  if (!s) {
    return (
      <div className="page">
        <EmptyState
          title="This onboarding checklist doesn’t exist"
          body="It may have been completed and archived."
          action={<Link className="btn btn-secondary btn-md" href="/onboarding">Back to onboarding</Link>}
        />
      </div>
    );
  }

  const e = s.employee;
  const manager = db.employees.find((x) => x.id === e.manager_id);
  const buddy = db.employees.find((x) => x.id === s.kase.buddy_id);
  const teammates = db.employees.filter((x) => x.status === "active" && x.department_id === e.department_id && x.id !== e.id);
  const d = daysBetween(today(), e.start_date);
  const owners = Array.from(new Set(s.tasks.map((t) => t.owner_role)));
  const visible = s.tasks.filter((t) => owner === "all" || t.owner_role === owner);

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/onboarding">Onboarding</Link>
        <Icon name="chevronRight" size={14} />
        <span aria-current="page">{displayName(e)}</span>
      </nav>

      <header className="profile-head">
        <Avatar person={e} size={64} />
        <div className="profile-title">
          <h1>{displayName(e)}</h1>
          <p className="muted">
            {e.job_title} · {d > 0 ? `starts ${formatDate(e.start_date)}, in ${d} day${d === 1 ? "" : "s"}` : d === 0 ? "starts today" : `started ${formatDate(e.start_date)}`}
          </p>
        </div>
        <div className="profile-actions">
          <Link href={`/employees/${e.id}`} className="btn btn-secondary btn-md">View profile</Link>
        </div>
      </header>

      <div className="case-grid">
        <div className="stack-lg">
          <div className="case-progress">
            <div className="case-progress-row">
              <strong className="num">{s.done} of {s.tasks.length} tasks done</strong>
              {s.overdue > 0 && <span className="text-danger">{s.overdue} overdue</span>}
            </div>
            <Progress value={s.done} max={s.tasks.length} label="Checklist progress" />
          </div>

          <div className="chips" role="group" aria-label="Filter tasks by owner">
            {(["all", ...owners] as const).map((o) => (
              <button key={o} type="button" className={`chip ${owner === o ? "chip-on" : ""}`} aria-pressed={owner === o} onClick={() => setOwner(o)}>
                {o === "all" ? "All owners" : ownerLabel[o]}
              </button>
            ))}
          </div>

          {PHASES.map((phase) => {
            const tasks = visible.filter((t) => t.phase === phase);
            if (!tasks.length) return null;
            const done = tasks.filter((t) => t.completed_at).length;
            return (
              <section key={phase} className="phase">
                <h2>{phaseLabel[phase]} <span className="count">{done}/{tasks.length}</span></h2>
                <ul className="tasks">
                  {tasks.map((t) => {
                    const late = !t.completed_at && t.due_date < today();
                    return (
                      <li key={t.id} className={`task ${t.completed_at ? "task-done" : ""}`}>
                        <label className="task-check">
                          <input type="checkbox" checked={!!t.completed_at} onChange={(ev) => setTaskDone(t.id, ev.target.checked)} />
                          <span className="box" aria-hidden="true"><Icon name="check" size={14} /></span>
                          <span className="task-title">{t.title}</span>
                        </label>
                        <span className="task-owner">{ownerLabel[t.owner_role]}</span>
                        <span className={`task-due num ${late ? "text-danger" : ""}`}>
                          {t.completed_at ? "Done" : late ? `Overdue · ${formatDate(t.due_date)}` : formatDate(t.due_date)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <aside className="stack-lg">
          <section className="panel">
            <h2>People</h2>
            <dl className="dl dl-stack">
              <div>
                <dt>Manager</dt>
                <dd>{manager ? <Link className="list-link" href={`/employees/${manager.id}`}><PersonCell person={manager} sub={manager.job_title} /></Link> : <span className="muted">No manager set</span>}</dd>
              </div>
              <div>
                <dt><label htmlFor="buddy">Onboarding buddy</label></dt>
                <dd>
                  <select id="buddy" className="select" value={s.kase.buddy_id ?? ""} onChange={(ev) => setBuddy(s.kase.id, ev.target.value || null)}>
                    <option value="">Not assigned</option>
                    {teammates.map((x) => <option key={x.id} value={x.id}>{displayName(x)}</option>)}
                  </select>
                  {!buddy && <p className="field-hint text-warn">Pick a teammate before day one so {e.preferred_name ?? e.first_name} has someone to ask.</p>}
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel">
            <h2>Details</h2>
            <dl className="dl dl-stack">
              <div><dt>Work email</dt><dd>{e.work_email}</dd></div>
              <div><dt>Location</dt><dd>{db.locations.find((l) => l.id === e.location_id)?.name ?? "—"}</dd></div>
              <div><dt>Template</dt><dd>Standard onboarding · {db.onboarding_template_tasks.length} tasks</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
