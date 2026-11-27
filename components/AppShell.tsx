"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useDb } from "@/lib/store";
import { Avatar, Icon } from "@/components/ui";
import type { IconName } from "@/components/ui/Icon";

const CURRENT_USER_ID = "e04"; // Signed-in HR admin for the prototype

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/employees";
  const db = useDb();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const me = db.employees.find((e) => e.id === CURRENT_USER_ID)!;
  const activeOnboarding = db.onboarding_cases.filter((c) => c.status === "in_progress").length;

  const nav: { href: string; label: string; icon: IconName; count?: number }[] = [
    { href: "/employees", label: "Employees", icon: "users" },
    { href: "/org-chart", label: "Org chart", icon: "org" },
    { href: "/onboarding", label: "Onboarding", icon: "checklist", count: activeOnboarding },
  ];

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
          <p className="nav-group">People</p>
          <ul>
            {nav.map((n) => {
              const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <li key={n.href}>
                  <Link href={n.href} className={`nav-link ${active ? "nav-active" : ""}`} aria-current={active ? "page" : undefined}>
                    <Icon name={n.icon} />
                    <span>{n.label}</span>
                    {n.count ? <span className="nav-count" aria-label={`${n.count} in progress`}>{n.count}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="nav-group">Coming next</p>
          <ul className="nav-soon">
            <li><span className="nav-link" aria-disabled="true"><Icon name="calendar" /><span>Time off</span></span></li>
            <li><span className="nav-link" aria-disabled="true"><Icon name="briefcase" /><span>Payroll</span></span></li>
          </ul>
        </nav>
        <div className="me">
          <Avatar person={me} size={32} />
          <span className="person-text">
            <span className="person-name">{me.first_name} {me.last_name}</span>
            <span className="person-sub">People admin</span>
          </span>
        </div>
      </aside>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}
      <main id="main" className="main">{children}</main>
    </div>
  );
}
