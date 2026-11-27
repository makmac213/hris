import type { Employee, EmploymentStatus, EmploymentType, OnboardingPhase, TaskOwnerRole } from "./types";

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const formatDate = (iso: string) => dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const formatShortDate = (iso: string) => shortFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

export function tenure(start: string, today: string): string {
  const days = daysBetween(start, today);
  if (days < 0) return `Starts in ${-days} day${days === -1 ? "" : "s"}`;
  const months = Math.floor(days / 30.44);
  if (months < 1) return `${days} day${days === 1 ? "" : "s"}`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(" ");
}

export const displayName = (e: Pick<Employee, "first_name" | "last_name" | "preferred_name">) =>
  `${e.preferred_name ?? e.first_name} ${e.last_name}`;

export const legalName = (e: Pick<Employee, "first_name" | "last_name">) => `${e.first_name} ${e.last_name}`;

export const initials = (e: Pick<Employee, "first_name" | "last_name" | "preferred_name">) =>
  `${(e.preferred_name ?? e.first_name)[0]}${e.last_name.replace(/^(von|van|de|del|dela|la)\s+/i, "")[0]}`.toUpperCase();

export const statusLabel: Record<EmploymentStatus, string> = {
  active: "Active",
  onboarding: "Onboarding",
  on_leave: "On leave",
  offboarded: "Former",
};

export const employmentTypeLabel: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contractor: "Contractor",
  intern: "Intern",
};

export const phaseLabel: Record<OnboardingPhase, string> = {
  before_start: "Before day one",
  first_day: "Day one",
  first_week: "First week",
  first_90_days: "First 90 days",
};

export const ownerLabel: Record<TaskOwnerRole, string> = {
  people_team: "People team",
  it: "IT",
  manager: "Manager",
  new_hire: "New hire",
  buddy: "Buddy",
};

export const formatBytes = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`);
