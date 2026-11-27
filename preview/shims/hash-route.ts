// Maps app paths to artifact-safe hashes (#employee-e12) and back.
import { useSyncExternalStore } from "react";

export function toHash(href: string): string {
  const [path, query = ""] = href.split("?");
  const focus = new URLSearchParams(query).get("focus");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "employees" && parts[1]) return `#employee-${parts[1]}`;
  if (parts[0] === "onboarding" && parts[1]) return `#onboarding-${parts[1]}`;
  if (parts[0] === "org-chart" && focus) return `#org-chart-${focus}`;
  return `#${parts[0] ?? "employees"}`;
}

export function fromHash(hash: string): { path: string; query: string } {
  const h = hash.replace(/^#/, "") || "employees";
  let m;
  if ((m = h.match(/^employee-(.+)$/))) return { path: `/employees/${m[1]}`, query: "" };
  if ((m = h.match(/^onboarding-(.+)$/))) return { path: `/onboarding/${m[1]}`, query: "" };
  if ((m = h.match(/^org-chart-(.+)$/))) return { path: "/org-chart", query: `focus=${m[1]}` };
  return { path: `/${h}`, query: "" };
}

const sub = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useHash(): string {
  return useSyncExternalStore(sub, () => window.location.hash, () => "");
}
