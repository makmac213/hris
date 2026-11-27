"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { reportingChain, useDb } from "@/lib/store";
import { displayName } from "@/lib/format";
import type { Employee } from "@/lib/types";
import { Avatar, Button, FilterSelect, Icon, SearchInput } from "@/components/ui";

export function OrgChartView() {
  const db = useDb();
  const params = useSearchParams();
  const focusId = params?.get("focus") ?? null;

  const people = useMemo(() => db.employees.filter((e) => e.status !== "offboarded"), [db.employees]);
  const children = useMemo(() => {
    const m = new Map<string, Employee[]>();
    for (const e of people) {
      const k = e.manager_id ?? "root";
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    for (const list of m.values()) list.sort((a, b) => (countAll(b.id) - countAll(a.id)) || displayName(a).localeCompare(displayName(b)));
    return m;
    function countAll(id: string): number {
      return people.filter((p) => p.manager_id === id).reduce((n, p) => n + 1 + countAll(p.id), 0);
    }
  }, [people]);

  const total = (id: string): number => (children.get(id) ?? []).reduce((n, c) => n + 1 + total(c.id), 0);

  const roots = children.get("root") ?? [];
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roots.map((r) => r.id)));
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [highlight, setHighlight] = useState<string | null>(focusId);
  const scroller = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLUListElement>(null);
  const [zoom, setZoom] = useState(1);

  // Fit the chart to the canvas width, never below 60% so names stay readable.
  const fit = () => {
    const box = scroller.current, t = tree.current;
    if (!box || !t) return;
    const natural = t.scrollWidth / zoom;
    setZoom(Math.max(0.6, Math.min(1, (box.clientWidth - 16) / natural)));
  };
  useEffect(() => { fit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (d: number) => setZoom((z) => Math.round(Math.min(1.25, Math.max(0.5, z + d)) * 100) / 100);

  const reveal = (id: string) => {
    const chain = reportingChain(db, id);
    setExpanded((prev) => new Set([...prev, ...chain.map((c) => c.id)]));
    setHighlight(id);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const box = scroller.current;
      const el = box?.querySelector<HTMLElement>(`[data-node="${id}"]`);
      if (!box || !el) return;
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      box.scrollBy({ left: r.left + r.width / 2 - (b.left + b.width / 2), top: r.top - b.top - 48, behavior: "smooth" });
      el.focus({ preventScroll: true });
    }));
  };

  useEffect(() => { if (focusId) reveal(focusId); }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return people.filter((e) => `${displayName(e)} ${e.job_title}`.toLowerCase().includes(n)).slice(0, 6);
  }, [q, people]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const expandAll = () => setExpanded(new Set(people.filter((p) => children.has(p.id)).map((p) => p.id)));
  const collapseAll = () => setExpanded(new Set());

  const renderNode = (e: Employee) => {
    const kids = children.get(e.id) ?? [];
    const isOpen = expanded.has(e.id);
    const dim = dept && e.department_id !== dept;
    return (
      <li key={e.id}>
        <div
          className={`node ${highlight === e.id ? "node-hl" : ""} ${dim ? "node-dim" : ""}`}
          data-node={e.id}
          tabIndex={-1}
        >
          <Link href={`/employees/${e.id}`} className="node-main">
            <Avatar person={e} size={36} />
            <span className="node-text">
              <span className="node-name">{displayName(e)}</span>
              <span className="node-title">{e.job_title}</span>
            </span>
          </Link>
          {kids.length > 0 && (
            <button
              type="button"
              className="node-toggle"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Hide" : "Show"} ${displayName(e)}’s team`}
              onClick={() => toggle(e.id)}
            >
              <span className="num">{kids.length} direct{total(e.id) > kids.length ? ` · ${total(e.id)} total` : ""}</span>
              <Icon name="chevronDown" size={14} className={isOpen ? "flip" : ""} />
            </button>
          )}
        </div>
        {kids.length > 0 && isOpen && (
          <ul className={kids.every((k) => !children.has(k.id)) ? "leaves" : undefined}>{kids.map(renderNode)}</ul>
        )}
      </li>
    );
  };

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1>Org chart</h1>
          <p className="muted">{people.length} people. Select anyone to open their profile.</p>
        </div>
      </header>

      <div className="toolbar">
        <div className="org-search">
          <SearchInput value={q} onChange={setQ} label="Find a person in the org chart" placeholder="Find a person" />
          {matches.length > 0 && (
            <ul className="menu" role="listbox" aria-label="Matching people">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => { reveal(m.id); setQ(""); }}>
                    <Avatar person={m} size={24} />
                    <span>{displayName(m)}</span>
                    <span className="muted">{m.job_title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim() && matches.length === 0 && <p className="menu menu-empty">No one matches “{q}”.</p>}
        </div>
        <div className="filters">
          <FilterSelect label="Departments" allLabel="Highlight a department" value={dept} onChange={setDept} options={db.departments.map((d) => ({ value: d.id, label: d.name }))} />
          <Button size="sm" variant="ghost" icon="expand" onClick={expandAll}>Expand all</Button>
          <Button size="sm" variant="ghost" icon="collapse" onClick={collapseAll}>Collapse all</Button>
        </div>
      </div>

      <div className="org-frame">
        <div className="org-canvas" ref={scroller}>
          <ul className="org" ref={tree} style={{ zoom }}>{roots.map(renderNode)}</ul>
        </div>
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => step(-0.1)} disabled={zoom <= 0.5}><Icon name="minus" size={18} /></button>
          <button type="button" className="zoom-value num" onClick={fit} title="Fit to width">{Math.round(zoom * 100)}%</button>
          <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => step(0.1)} disabled={zoom >= 1.25}><Icon name="plus" size={18} /></button>
        </div>
      </div>
    </div>
  );
}
