// Maps app paths to artifact-safe hashes (#employee-e12) and back.
import { useSyncExternalStore } from "react";

export function toHash(href: string): string {
  const [path, query = ""] = href.split("?");
  const focus = new URLSearchParams(query).get("focus");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "employees" && parts[1]) return `#employee-${parts[1]}`;
  if (parts[0] === "onboarding" && parts[1]) return `#onboarding-${parts[1]}`;
  if (parts[0] === "org-chart" && focus) return `#org-chart-${focus}`;
  if (parts[0] === "time" && parts[1] === "shift-codes") return "#shift-codes";
  if (parts[0] === "payroll" && parts[1] === "pay-types") return "#pay-types";
  if (parts[0] === "payroll" && parts[1] === "year-end") return "#year-end";
  const report = new URLSearchParams(query).get("r");
  if (parts[0] === "reports" && report) return `#reports-${report}`;
  const date = new URLSearchParams(query).get("date");
  if (parts[0] === "schedule" && date) return `#schedule-${date}`;
  const fix = new URLSearchParams(query).get("fix");
  if (parts[0] === "my-time" && fix) return `#my-time-fix-${fix}`;
  return `#${parts[0] ?? "employees"}`;
}

export function fromHash(hash: string): { path: string; query: string } {
  const h = hash.replace(/^#/, "") || "employees";
  let m;
  if ((m = h.match(/^employee-(.+)$/))) return { path: `/employees/${m[1]}`, query: "" };
  if ((m = h.match(/^onboarding-(.+)$/))) return { path: `/onboarding/${m[1]}`, query: "" };
  if ((m = h.match(/^org-chart-(.+)$/))) return { path: "/org-chart", query: `focus=${m[1]}` };
  if (h === "shift-codes") return { path: "/time/shift-codes", query: "" };
  if (h === "pay-types") return { path: "/payroll/pay-types", query: "" };
  if (h === "year-end") return { path: "/payroll/year-end", query: "" };
  if ((m = h.match(/^reports-([a-z0-9-]+)$/))) return { path: "/reports", query: `r=${m[1]}` };
  if ((m = h.match(/^schedule-(\d{4}-\d{2}-\d{2})$/))) return { path: "/schedule", query: `date=${m[1]}` };
  if ((m = h.match(/^my-time-fix-(\d{4}-\d{2}-\d{2})$/))) return { path: "/my-time", query: `fix=${m[1]}` };
  return { path: `/${h}`, query: "" };
}

const sub = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useHash(): string {
  return useSyncExternalStore(sub, () => window.location.hash, () => "");
}
