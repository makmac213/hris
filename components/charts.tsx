"use client";

// Small SVG charts for reports, following the dataviz method: thin marks, 4px rounded data ends square at the
// baseline, 2px lines, a 2px surface gap between touching bars, hairline grid, one axis, a legend for two
// series, a hover or focus tooltip on every mark, and a data table under every chart.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Chart, ValueKind } from "@/lib/reports/types";
import { compact, formatValue } from "@/lib/reports/format";

const H = 220;
const M = { l: 48, r: 16, t: 16, b: 28 };
const SERIES = ["var(--viz-1)", "var(--viz-2)"];

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Round numbers for the axis: 0 and up to 4 steps. Counts step in whole numbers. */
function ticks(max: number, kind: ValueKind): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  if (kind === "number" || kind === "days") step = Math.max(1, Math.ceil(step));
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** A path for a column: 4px rounded data end at the top, square at the baseline. */
function column(x: number, y: number, w: number, base: number) {
  const r = Math.min(4, w / 2, Math.max(0, base - y));
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}
/** A horizontal bar: rounded at the value end. */
function bar(x0: number, y: number, len: number, h: number) {
  const r = Math.min(4, h / 2, len);
  return `M${x0},${y}H${x0 + len - r}Q${x0 + len},${y} ${x0 + len},${y + r}V${y + h - r}Q${x0 + len},${y + h} ${x0 + len - r},${y + h}H${x0}Z`;
}

interface Tip { x: number; y: number; title: string; rows: { name: string; value: string; color: string }[] }
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="viz-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.name} className="viz-tip-row">
          <span className="viz-key" style={{ background: r.color }} aria-hidden="true" />
          <strong>{r.value}</strong>
          <span>{r.name}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null;
  return (
    <ul className="viz-legend">
      {names.map((n, i) => <li key={n}><span className="viz-swatch" style={{ background: SERIES[i] }} aria-hidden="true" />{n}</li>)}
    </ul>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="viz-data">
      <summary>Show data</summary>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>{head.map((h, i) => <th key={h} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : ""}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

function Frame({ title, legend, children, table }: { title: string; legend?: ReactNode; children: ReactNode; table: ReactNode }) {
  return (
    <figure className="viz">
      <figcaption className="viz-title">{title}</figcaption>
      {legend}
      {children}
      {table}
    </figure>
  );
}

// ---- Line: trend over time, with a crosshair that snaps to the nearest point -------------------------

function LineChart({ c }: { c: Extract<Chart, { kind: "line" }> }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [i, setI] = useState<number | null>(null);
  const max = Math.max(1, ...c.series.flatMap((s) => s.values));
  const t = ticks(max, c.valueKind), top = t[t.length - 1];
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const x = (k: number) => M.l + (c.x.length > 1 ? (k / (c.x.length - 1)) * iw : iw / 2);
  const y = (v: number) => M.t + ih - (v / top) * ih;
  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const k = Math.round(((clientX - r.left - M.l) / iw) * (c.x.length - 1));
    setI(Math.max(0, Math.min(c.x.length - 1, k)));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setI((v) => Math.min(c.x.length - 1, (v ?? -1) + 1));
    if (e.key === "ArrowLeft") setI((v) => Math.max(0, (v ?? c.x.length) - 1));
  };
  const last = c.x.length - 1;
  const tip: Tip | null = i === null ? null : { x: Math.min(x(i) + 12, W - 180), y: M.t, title: c.x[i], rows: c.series.map((s, k) => ({ name: s.name, value: formatValue(s.values[i], c.valueKind), color: SERIES[k] })) };
  return (
    <Frame title={c.title} legend={<Legend names={c.series.map((s) => s.name)} />}
      table={<DataTable head={["", ...c.series.map((s) => s.name)]} rows={c.x.map((lab, k) => [lab, ...c.series.map((s) => formatValue(s.values[k], c.valueKind))])} />}>
      <div className="viz-plot" ref={ref}>
        <svg width={W} height={H} role="img" aria-label={`${c.title}. Use the arrow keys to read each point.`} tabIndex={0} onKeyDown={key} onBlur={() => setI(null)}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setI(null)}>
          {t.map((v) => <g key={v}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className={v ? "viz-grid" : "viz-base"} /><text x={M.l - 8} y={y(v)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{compact(v, c.valueKind)}</text></g>)}
          {c.x.map((lab, k) => (k % Math.ceil(c.x.length / 6) === 0 || k === last) && <text key={lab} x={x(k)} y={H - 8} className="viz-tick" textAnchor="middle">{lab}</text>)}
          {c.series.map((s, k) => (
            <g key={s.name}>
              {c.series.length === 1 && <path d={`M${x(0)},${y(0)}${s.values.map((v, j) => `L${x(j)},${y(v)}`).join("")}L${x(last)},${y(0)}Z`} fill={SERIES[k]} opacity={0.1} />}
              <path d={s.values.map((v, j) => `${j ? "L" : "M"}${x(j)},${y(v)}`).join("")} fill="none" stroke={SERIES[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(last)} cy={y(s.values[last])} r={4} fill={SERIES[k]} className="viz-ring" />
              <text x={x(last) - 8} y={y(s.values[last]) - 10} className="viz-label" textAnchor="end">{formatValue(s.values[last], c.valueKind)}</text>
            </g>
          ))}
          {i !== null && <line x1={x(i)} x2={x(i)} y1={M.t} y2={M.t + ih} className="viz-cross" />}
          {i !== null && c.series.map((s, k) => <circle key={s.name} cx={x(i)} cy={y(s.values[i])} r={4} fill={SERIES[k]} className="viz-ring" />)}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </Frame>
  );
}

// ---- Columns: one or two series per period ------------------------------------------------------------

function ColumnChart({ c }: { c: Extract<Chart, { kind: "columns" }> }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ k: number; s: number } | null>(null);
  const max = Math.max(1, ...c.series.flatMap((s) => s.values));
  const t = ticks(max, c.valueKind), top = t[t.length - 1];
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const band = iw / c.x.length;
  const n = c.series.length;
  const bw = Math.min(24, (band * 0.7 - (n - 1) * 2) / n);
  const y = (v: number) => M.t + ih - (v / top) * ih;
  const base = M.t + ih;
  const x0 = (k: number) => M.l + k * band + (band - (bw * n + 2 * (n - 1))) / 2;
  const tip: Tip | null = hover === null ? null : {
    x: Math.min(x0(hover.k) + bw * n + 8, W - 180), y: M.t, title: c.x[hover.k],
    rows: c.series.map((s, j) => ({ name: s.name, value: formatValue(s.values[hover.k], c.valueKind), color: SERIES[j] })),
  };
  return (
    <Frame title={c.title} legend={<Legend names={c.series.map((s) => s.name)} />}
      table={<DataTable head={["", ...c.series.map((s) => s.name)]} rows={c.x.map((lab, k) => [lab, ...c.series.map((s) => formatValue(s.values[k], c.valueKind))])} />}>
      <div className="viz-plot" ref={ref}>
        <svg width={W} height={H} role="img" aria-label={c.title} onPointerLeave={() => setHover(null)}>
          {t.map((v) => <g key={v}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className={v ? "viz-grid" : "viz-base"} /><text x={M.l - 8} y={y(v)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{compact(v, c.valueKind)}</text></g>)}
          {c.x.map((lab, k) => (
            <g key={lab}>
              {(k % Math.ceil(c.x.length / 6) === 0 || k === c.x.length - 1) && <text x={M.l + k * band + band / 2} y={H - 8} className="viz-tick" textAnchor="middle">{lab}</text>}
              {c.series.map((s, j) => s.values[k] > 0 && (
                <path key={s.name} d={column(x0(k) + j * (bw + 2), y(s.values[k]), bw, base)} fill={SERIES[j]} className={hover?.k === k ? "viz-mark viz-on" : "viz-mark"} />
              ))}
              {/* The whole band is the hit target, bigger than the bars. */}
              <rect x={M.l + k * band} y={M.t} width={band} height={ih} fill="transparent" tabIndex={0} aria-label={`${lab}: ${c.series.map((s) => `${s.name} ${formatValue(s.values[k], c.valueKind)}`).join(", ")}`}
                onPointerEnter={() => setHover({ k, s: 0 })} onFocus={() => setHover({ k, s: 0 })} onBlur={() => setHover(null)} />
            </g>
          ))}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </Frame>
  );
}

// ---- Bars: ranked, one hue, value at the tip ----------------------------------------------------------

function BarChart({ c }: { c: Extract<Chart, { kind: "bars" }> }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const items = c.items.slice(0, 12);
  const labelW = Math.min(180, Math.max(90, ...items.map((it) => it.label.length * 7)));
  const valueW = 84;
  const max = Math.max(1, ...items.map((it) => it.value));
  const iw = Math.max(40, W - labelW - valueW - 8);
  const row = 28, bh = 16;
  const h = items.length * row + 4;
  return (
    <Frame title={c.title} table={<DataTable head={["", "Value"]} rows={c.items.map((it) => [it.label, formatValue(it.value, c.valueKind)])} />}>
      <div className="viz-plot" ref={ref}>
        {items.length === 0 ? <p className="muted small">Nothing to show for these filters.</p> : (
          <svg width={W} height={h} role="img" aria-label={c.title} onPointerLeave={() => setHover(null)}>
            <line x1={labelW} x2={labelW} y1={0} y2={h} className="viz-base" />
            {items.map((it, k) => {
              const len = Math.max(it.value > 0 ? 2 : 0, (it.value / max) * iw);
              const yy = k * row + (row - bh) / 2;
              return (
                <g key={it.label} tabIndex={0} aria-label={`${it.label}: ${formatValue(it.value, c.valueKind)}`}
                  onPointerEnter={() => setHover(k)} onFocus={() => setHover(k)} onBlur={() => setHover(null)}>
                  <rect x={0} y={k * row} width={W} height={row} fill="transparent" />
                  <text x={labelW - 8} y={yy + bh / 2} className="viz-cat" textAnchor="end" dominantBaseline="middle">{it.label.length > 24 ? `${it.label.slice(0, 23)}…` : it.label}</text>
                  {len > 0 && <path d={bar(labelW, yy, len, bh)} fill="var(--viz-1)" className={hover === k ? "viz-mark viz-on" : "viz-mark"} />}
                  <text x={labelW + len + 6} y={yy + bh / 2} className="viz-label" dominantBaseline="middle">{compact(it.value, c.valueKind)}</text>
                </g>
              );
            })}
          </svg>
        )}
        <Tooltip tip={hover === null ? null : { x: Math.min(labelW + (items[hover].value / max) * iw + 60, W - 180), y: hover * row, title: items[hover].label, rows: [{ name: c.title, value: formatValue(items[hover].value, c.valueKind), color: "var(--viz-1)" }] }} />
      </div>
    </Frame>
  );
}

export function ChartView({ chart }: { chart: Chart }) {
  if (chart.kind === "line") return <LineChart c={chart} />;
  if (chart.kind === "columns") return <ColumnChart c={chart} />;
  return <BarChart c={chart} />;
}

export function KpiTile({ label, value, kind, note }: { label: string; value: number | string; kind: ValueKind; note?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{typeof value === "number" ? formatValue(value, kind) : value}</strong>
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}
