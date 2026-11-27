"use client";

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Employee, EmploymentStatus } from "@/lib/types";
import { displayName, initials, statusLabel } from "@/lib/format";
import { Icon, type IconName } from "./Icon";

export { Icon };

// ---- Button ---------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  icon?: IconName;
};

export function Button({ variant = "secondary", size = "md", icon, className = "", children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children}
    </button>
  );
}

// ---- Avatar ---------------------------------------------------------------

const HUES = [255, 200, 160, 75, 30, 320];

export function Avatar({ person, size = 32 }: { person: Pick<Employee, "id" | "first_name" | "last_name" | "preferred_name">; size?: number }) {
  const n = [...person.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = HUES[n % HUES.length];
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ["--h" as string]: hue }}
      aria-hidden="true"
    >
      {initials(person)}
    </span>
  );
}

export function PersonCell({ person, sub }: { person: Employee; sub?: ReactNode }) {
  return (
    <span className="person">
      <Avatar person={person} size={32} />
      <span className="person-text">
        <span className="person-name">{displayName(person)}</span>
        {sub !== undefined && <span className="person-sub">{sub}</span>}
      </span>
    </span>
  );
}

// ---- Status badge ---------------------------------------------------------

export function StatusBadge({ status }: { status: EmploymentStatus }) {
  return <span className={`badge badge-${status}`}>{statusLabel[status]}</span>;
}

// ---- Fields ---------------------------------------------------------------

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId();
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={`field ${error ? "field-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, descId)}
      {(error || hint) && <p id={descId} className="field-hint">{error ?? hint}</p>}
    </div>
  );
}

export function SearchInput({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onChange("")}>
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

export function FilterSelect<T extends string>({ label, value, onChange, options, allLabel }: { label: string; value: T | ""; onChange: (v: T | "") => void; options: { value: T; label: string }[]; allLabel?: string }) {
  return (
    <label className={`filter ${value ? "filter-on" : ""}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T | "")}>
        <option value="">{allLabel ?? `All ${label.toLowerCase()}`}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <Icon name="chevronDown" size={16} />
    </label>
  );
}

// ---- Dialog ---------------------------------------------------------------

export function Dialog({ title, description, onClose, children, footer }: { title: string; description?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>("input, select, textarea, button:not([disabled]), a[href]");
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p className="muted">{description}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-foot">{footer}</footer>
      </div>
    </div>
  );
}

// ---- Empty state ----------------------------------------------------------

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

// ---- Progress -------------------------------------------------------------

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <span className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
