"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { caseSummary, today, useDb, type CaseSummary } from "@/lib/store";
import { daysBetween, displayName, formatDate, ownerLabel } from "@/lib/format";
import { Button, EmptyState, PersonCell, Progress } from "@/components/ui";
import { AddEmployeeDialog } from "@/features/directory/AddEmployeeDialog";

function when(start: string) {
  const d = daysBetween(today(), start);
  if (d === 0) return "Starts today";
  if (d > 0) return d === 1 ? "Starts tomorrow" : `Starts in ${d} days`;
  return `Day ${-d + 1}`;
}

export function OnboardingListView() {
  const db = useDb();
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  const cases = db.onboarding_cases
    .filter((c) => c.status === "in_progress")
    .map((c) => caseSummary(db, c))
    .filter((c): c is CaseSummary => c !== null)
    .sort((a, b) => a.employee.start_date.localeCompare(b.employee.start_date));

  const upcoming = cases.filter((c) => c.employee.start_date > today());
  const started = cases.filter((c) => c.employee.start_date <= today());
  const overdue = cases.reduce((n, c) => n + c.overdue, 0);

  const section = (title: string, list: CaseSummary[], empty: string) => (
    <section className="section">
      <h2>{title} <span className="count">{list.length}</span></h2>
      {list.length === 0 ? <p className="muted">{empty}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>New hire</th>
                <th className="col-md">Start date</th>
                <th>Progress</th>
                <th className="col-lg">Next task</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.kase.id} className="row-link" onClick={(ev) => { if (!(ev.target as HTMLElement).closest("a")) router.push(`/onboarding/${c.kase.id}`); }}>
                  <td>
                    <Link href={`/onboarding/${c.kase.id}`} className="row-anchor"><PersonCell person={c.employee} sub={c.employee.job_title} /></Link>
                  </td>
                  <td className="col-md">
                    <span className="cell-2">
                      <span className="num">{formatDate(c.employee.start_date)}</span>
                      <span className="muted">{when(c.employee.start_date)}</span>
                    </span>
                  </td>
                  <td>
                    <span className="cell-progress">
                      <Progress value={c.done} max={c.tasks.length} label={`${displayName(c.employee)} onboarding progress`} />
                      <span className="num">{c.done}/{c.tasks.length}</span>
                      {c.overdue > 0 && <span className="badge badge-danger">{c.overdue} overdue</span>}
                    </span>
                  </td>
                  <td className="col-lg">
                    {c.next ? (
                      <span className="cell-2">
                        <span>{c.next.title}</span>
                        <span className={c.next.due_date < today() ? "text-danger" : "muted"}>{ownerLabel[c.next.owner_role]} · {c.next.due_date < today() ? "overdue since" : "due"} {formatDate(c.next.due_date)}</span>
                      </span>
                    ) : <span className="muted">All tasks done</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Onboarding</h1>
          <p className="muted">
            {cases.length} new hires in progress
            {overdue > 0 && <> · <span className="text-danger">{overdue} overdue {overdue === 1 ? "task" : "tasks"}</span></>}
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add new hire</Button>
      </header>

      {cases.length === 0 ? (
        <EmptyState
          title="No one is onboarding right now"
          body="Add a new hire and we’ll create their checklist from the standard template, with due dates set from their start date."
          action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add new hire</Button>}
        />
      ) : (
        <>
          {section("Starting soon", upcoming, "No upcoming start dates.")}
          {section("In their first 90 days", started, "No one has started yet.")}
        </>
      )}

      {adding && <AddEmployeeDialog onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); router.push(`/onboarding/ob-${id}`); }} />}
    </div>
  );
}
