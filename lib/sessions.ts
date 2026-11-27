// A day's punches as worked sessions. Pure: no schedule or database. Used by payroll, attendance and punch checks.

import type { TimeRecord, TimeRecordKind } from "./types";

const ms = (r: TimeRecord) => Date.parse(r.recorded_at);


export interface Session { in: TimeRecord; out: TimeRecord | null }
export interface DayPunches {
  sessions: Session[];
  /** A time out with no time in before it. Kept, but not paid. */
  strayOuts: TimeRecord[];
  /** Timed in and never timed out. */
  open: boolean;
  first: TimeRecord | undefined;
  last: TimeRecord | undefined;
}

/**
 * Pairs a day's punches into in-out sessions, oldest first. An approved correction replaces the
 * first time in or the last time out; a corrected time out closes a day left open. Originals are never edited.
 */
export function sessionsOf(records: TimeRecord[]): DayPunches {
  const latest = (k: TimeRecordKind) => records.filter((r) => r.kind === k && r.source === "correction").sort((a, b) => ms(b) - ms(a))[0];
  let list = records.filter((r) => r.source === "device").sort((a, b) => ms(a) - ms(b));
  const cIn = latest("clock_in"), cOut = latest("clock_out");
  if (cIn) {
    const i = list.findIndex((r) => r.kind === "clock_in");
    list = i >= 0 ? list.map((r, j) => (j === i ? cIn : r)) : [cIn, ...list];
  }
  if (cOut) {
    const lastDev = list[list.length - 1];
    list = lastDev?.kind === "clock_out" ? [...list.slice(0, -1), cOut] : [...list, cOut];
  }
  list.sort((a, b) => ms(a) - ms(b));

  const sessions: Session[] = [], strayOuts: TimeRecord[] = [];
  for (const r of list) {
    const cur = sessions[sessions.length - 1];
    if (r.kind === "clock_in") { if (!cur || cur.out) sessions.push({ in: r, out: null }); } // a second time in while timed in adds nothing
    else if (cur && !cur.out) cur.out = r;
    else strayOuts.push(r);
  }
  const lastS = sessions[sessions.length - 1];
  return { sessions, strayOuts, open: !!lastS && !lastS.out, first: sessions[0]?.in, last: lastS?.out ?? undefined };
}

/** Milliseconds of [a0, a1] that fall inside [b0, b1]. */
export const overlapMs = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Closed sessions as [from, to] in milliseconds. */
export const intervals = (d: DayPunches) => d.sessions.filter((s) => s.out).map((s) => [ms(s.in), ms(s.out!)] as const);

