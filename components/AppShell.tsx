"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PROTOTYPE_USERS, canApprove, setCurrentUser, useCurrentUser, useDb } from "@/lib/store";
import { Avatar, Icon } from "@/components/ui";
import type { IconName } from "@/components/ui/Icon";

type NavItem = { href: string; label: string; icon: IconName; count?: number; exact?: boolean };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/employees";
  const router = useRouter();
  const db = useDb();
  const { employee: me, canManage, role } = useCurrentUser();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const activeOnboarding = db.onboarding_cases.filter((c) => c.status === "in_progress").length;
  const isManager = db.employees.some((e) => e.manager_id === me.id && e.status !== "offboarded");
  const pendingForMe = [...db.overtime_requests, ...db.correction_requests].filter((r) => r.status === "pending" && canApprove(db, me, r.employee_id)).length;

  const groups: { title: string; items: NavItem[] }[] = canManage
    ? [
        { title: "People", items: [
          { href: "/employees", label: "Employees", icon: "users" },
          { href: "/org-chart", label: "Org chart", icon: "org" },
          { href: "/onboarding", label: "Onboarding", icon: "checklist", count: activeOnboarding },
        ] },
        { title: "Time and pay", items: [
          { href: "/time", label: "Attendance", icon: "calendar", exact: true },
          { href: "/approvals", label: "Approvals", icon: "check", count: pendingForMe },
          { href: "/payroll", label: "Payroll", icon: "wallet" },
          { href: "/time/shift-codes", label: "Shift codes", icon: "shift" },
        ] },
        { title: "Me", items: [
          { href: "/my-time", label: "My time", icon: "clock" },
          { href: "/my-pay", label: "My pay", icon: "file" },
        ] },
      ]
    : [
        { title: "Me", items: [
          { href: "/my-time", label: "My time", icon: "clock" },
          { href: "/my-pay", label: "My pay", icon: "wallet" },
          ...(isManager ? [{ href: "/approvals", label: "Team approvals", icon: "check" as IconName, count: pendingForMe }] : []),
        ] },
        { title: "Company", items: [
          { href: "/employees", label: "Employees", icon: "users" },
          { href: "/org-chart", label: "Org chart", icon: "org" },
        ] },
      ];

  const switchUser = (id: string) => {
    setCurrentUser(id);
    const next = PROTOTYPE_USERS.find((u) => u.id === id);
    if (next && !["Admin", "HR"].includes(next.sub)) router.push(next.sub === "Manager" ? "/approvals" : "/my-time");
  };

  return (
    <div className="shell">
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="menu" />
        </button>
        <span className="brand-name">Halden</span>
      </header>
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span className="brand-name">Halden</span>
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
              <span className="person-sub">{role === "admin" ? "Admin" : role === "hr" ? "HR" : isManager ? "Manager" : "Employee"}</span>
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
