"use client";

import { useEffect, useState } from "react";
import type { Employee, ShiftCode, ShiftSource } from "@/lib/types";
import { dayStatusLabel, formatDuration, shiftHours, spanMinutes, type DaySummary } from "@/lib/time";

/** Live "now" that ticks every 15 seconds (or every second when `seconds` is set). */
export function useNow(seconds = false): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), seconds ? 1000 : 15000);
    return () => clearInterval(t);
  }, [seconds]);
  return now;
}

/** Time-record photo. Mock records carry `mock:<id>` and render a neutral placeholder portrait. */
export function ProofPhoto({ path, size = 40, alt }: { path: string; size?: number; alt: string }) {
  if (path.startsWith("data:")) {
    return <img src={path} alt={alt} width={size} height={size} className="proof-photo" style={{ width: size, height: size }} />;
  }
  const n = [...path].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = [255, 200, 160, 75, 30, 320][n % 6];
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className="proof-photo" role="img" aria-label={alt}>
      <rect width="40" height="40" fill={`oklch(0.9 0.03 ${hue})`} />
      <circle cx="20" cy="16" r="7" fill={`oklch(0.72 0.05 ${hue})`} />
      <path d="M6 40c1-9 7-14 14-14s13 5 14 14z" fill={`oklch(0.72 0.05 ${hue})`} />
    </svg>
  );
}

export const mapsUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

export const formatCoords = (lat: number, lng: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;

export function DayStatusBadge({ s }: { s: DaySummary }) {
  if (s.status === "working" || s.status === "done") {
    if (s.lateMinutes > 0) return <span className="badge badge-on_leave">Late {formatDuration(s.lateMinutes)}</span>;
    if (s.undertimeMinutes > 0) return <span className="badge badge-on_leave">Left {formatDuration(s.undertimeMinutes)} early</span>;
    return <span className="muted">{s.status === "working" ? "Timed in" : "On time"}</span>;
  }
  const cls: Partial<Record<DaySummary["status"], string>> = {
    absent: "badge badge-danger",
    missing_out: "badge badge-danger",
    not_in: "badge badge-on_leave",
    on_leave: "badge badge-offboarded",
  };
  return cls[s.status] ? <span className={cls[s.status]}>{dayStatusLabel[s.status]}</span> : <span className="muted">{dayStatusLabel[s.status]}</span>;
}

export const sourceLabel: Record<ShiftSource, string> = {
  system_default: "Philippine default",
  uploaded: "Uploaded",
  manual: "Added manually",
};

export function ShiftSummary({ shift }: { shift: ShiftCode | undefined }) {
  if (!shift) return <span className="muted">No shift code</span>;
  return (
    <span className="cell-2">
      <span><span className="code">{shift.code}</span></span>
      <span className="muted num">{shiftHours(shift)}</span>
    </span>
  );
}

export const paidMinutes = (s: ShiftCode) => spanMinutes(s) - s.break_minutes;

export const firstName = (e: Employee) => e.preferred_name ?? e.first_name;
