"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PROTOTYPE_USERS, canApprove, markNotificationsRead, setCurrentUser, today, useCurrentUser, useDb } from "@/lib/store";
import { coverageGaps, datesFrom } from "@/lib/schedule";
import { Avatar, Icon } from "@/components/ui";
import type { IconName } from "@/components/ui/Icon";

type NavItem = { href: string; label: string; icon: IconName; count?: number; exact?: boolean };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/employees";
  const router = useRouter();
  const db = useDb();
  const { employee: me, canManage, canSchedule, role } = useCurrentUser();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const activeOnboarding = db.onboarding_cases.filter((c) => c.status === "in_progress").length;
  const isManager = db.employees.some((e) => e.manager_id === me.id && e.status !== "offboarded");
  const openGaps = canSchedule ? coverageGaps(db, db.employees.filter((e) => e.status !== "offboarded"), datesFrom(today(), 14), today()).filter((g) => !g.cell.coveredBy).length : 0;
  const pendingForMe = [...db.overtime_requests, ...db.correction_requests, ...db.leave_requests].filter((r) => r.status === "pending" && canApprove(db, me, r.employee_id)).length;

  const groups: { title: string; items: NavItem[] }[] = canManage
    ? [
        { title: "People", items: [
          { href: "/employees", label: "Employees", icon: "users" },
          { href: "/org-chart", label: "Org chart", icon: "org" },
          { href: "/organization", label: "Organization", icon: "building" },
          { href: "/onboarding", label: "Onboarding", icon: "checklist", count: activeOnboarding },
        ] },
        { title: "Time and pay", items: [
          { href: "/schedule", label: "Schedule", icon: "shift", count: openGaps },
          { href: "/time", label: "Attendance", icon: "calendar", exact: true },
          { href: "/approvals", label: "Approvals", icon: "check", count: pendingForMe },
          { href: "/payroll", label: "Payroll", icon: "wallet" },
          { href: "/leave", label: "Leave policies", icon: "sun" },
          { href: "/time/shift-codes", label: "Shift codes", icon: "clock" },
        ] },
        { title: "Me", items: [
          { href: "/my-time", label: "My time", icon: "clock" },
          { href: "/my-leave", label: "My leave", icon: "sun" },
          { href: "/my-pay", label: "My pay", icon: "file" },
        ] },
      ]
    : [
        ...(canSchedule ? [{ title: "Operations", items: [
          { href: "/schedule", label: "Schedule", icon: "shift" as IconName, count: openGaps },
        ] }] : []),
        { title: "Me", items: [
          { href: "/my-time", label: "My time", icon: "clock" },
          { href: "/my-leave", label: "My leave", icon: "sun" },
          { href: "/my-pay", label: "My pay", icon: "wallet" },
          ...(isManager ? [{ href: "/approvals", label: "Team approvals", icon: "check" as IconName, count: pendingForMe }] : []),
          ...(isManager && !canSchedule ? [{ href: "/schedule", label: "Team schedule", icon: "shift" as IconName }] : []),
        ] },
        { title: "Company", items: [
          { href: "/employees", label: "Employees", icon: "users" },
          { href: "/org-chart", label: "Org chart", icon: "org" },
        ] },
      ];

  const switchUser = (id: string) => {
    setCurrentUser(id);
    const next = PROTOTYPE_USERS.find((u) => u.id === id);
    if (next && !["Admin", "HR"].includes(next.sub)) router.push(next.sub === "Operations" ? "/schedule" : next.sub === "Manager" || next.sub === "Team lead" ? "/approvals" : "/my-time");
  };

  return (
    <div className="shell">
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="menu" />
        </button>
        <span className="brand-name">Halden</span>
        <Notifications />
      </header>
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span className="brand-name">Halden</span>
          <Notifications />
        </div>
        <nav aria-label="Main">
          {groups.map((g) => (
            <div key={g.title} className="nav-section">
              <p className="nav-group">{g.title}</p>
              <ul>
                {g.items.map((n) => {
                  const active = pathname === n.href || (!n.exact && pathname.startsWith(`${n.href}/`));
                  return (
                    <li key={n.href}>
                      <Link href={n.href} className={`nav-link ${active ? "nav-active" : ""}`} aria-current={active ? "page" : undefined}>
                        <Icon name={n.icon} />
                        <span>{n.label}</span>
                        {n.count ? <span className="nav-count" aria-label={`${n.count} waiting`}>{n.count}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="me">
          <div className="me-row">
            <Avatar person={me} size={32} />
            <span className="person-text">
              <span className="person-name">{me.preferred_name ?? me.first_name} {me.last_name}</span>
              <span className="person-sub">{role === "admin" ? "Admin" : role === "hr" ? "HR" : role === "operations" ? "Operations" : isManager ? "Manager" : "Employee"}</span>
            </span>
          </div>
          <label className="switcher">
            <span>Prototype: view as</span>
            <select value={me.id} onChange={(e) => switchUser(e.target.value)}>
              {PROTOTYPE_USERS.map((u) => <option key={u.id} value={u.id}>{u.label} ({u.sub})</option>)}
            </select>
          </label>
        </div>
      </aside>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}
      <main id="main" className="main">{children}</main>
    </div>
  );
}

// ---- Notifications ---------------------------------------------------------------

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
};

function Notifications() {
  const db = useDb();
  const router = useRouter();
  const { employee: me } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  const mine = db.notifications.filter((n) => n.recipient_id === me.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const unread = mine.filter((n) => !n.read_at).length;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="ntf">
      <button type="button" className="icon-btn ntf-btn" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="bell" />
        {unread > 0 && <span className="ntf-dot num" aria-hidden="true">{unread}</span>}
      </button>
      {open && (
        <>
          <div className="ntf-scrim" onClick={() => setOpen(false)} />
          <div className="ntf-panel" role="dialog" aria-label="Notifications">
            <div className="ntf-head">
              <h2>Notifications</h2>
              {unread > 0 && <button type="button" className="link small" onClick={() => markNotificationsRead(me.id)}>Mark all read</button>}
            </div>
            {mine.length === 0 ? <p className="muted ntf-empty">Nothing yet. Schedule changes that need you show up here.</p> : (
              <ul className="ntf-list">
                {mine.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`ntf-item ${n.read_at ? "" : "ntf-unread"}`} onClick={() => { markNotificationsRead(me.id, [n.id]); setOpen(false); router.push(n.link); }}>
                      <span className="ntf-title">{n.title}</span>
                      <span className="ntf-body">{n.body}</span>
                      <span className="ntf-time">{ago(n.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
