"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { today, useCurrentUser, useDb } from "@/lib/store";
import { addDays, displayName, formatDate } from "@/lib/format";
import { availableReports, CATEGORY_LABEL, parseParams, runReport, viewerFor, type Category, type FilterKey, type ReportDef } from "@/lib/reports";
import { csvFilename, toCsv } from "@/lib/reports/csv";
import { formatValue, numericKinds } from "@/lib/reports/format";
import { monthName } from "@/lib/reports/payroll";
import { Button, EmptyState, FilterSelect, SearchInput } from "@/components/ui";
import { ChartView, KpiTile } from "@/components/charts";

const ORDER: Category[] = ["executive", "hr", "payroll", "audit"];
type Query = Record<string, string | undefined>;

export function ReportsView() {
  const db = useDb();
  const { employee: me } = useCurrentUser();
  const viewer = useMemo(() => viewerFor(db, me), [db, me]);
  const reports = availableReports(viewer);
  const initial = useSearchParams().get("r");
  const [key, setKey] = useState<string | null>(initial);
  const [query, setQuery] = useState<Query>({});
  useEffect(() => { if (initial) { setKey(initial); setQuery({}); } }, [initial]);
  const report = reports.find((r) => r.key === key) ?? reports[0];

  if (!report) {
    return <div className="page"><header className="page-head"><div><h1>Reports</h1></div></header><EmptyState title="No reports for your role" body="Reports are for HR, executives, operations and people who manage a team." /></div>;
  }
  const choose = (k: string) => { setKey(k); setQuery({}); };

  return (
    <div className="page reports-page">
      <header className="page-head no-print">
        <div>
          <h1>Reports</h1>
          <p className="muted">Every report filters, exports to CSV and prints or saves as a PDF. The same reports are in the API.</p>
        </div>
      </header>
      <div className="reports-layout">
        <nav className="report-nav no-print" aria-label="Reports">
          {ORDER.filter((c) => reports.some((r) => r.category === c)).map((c) => (
            <div key={c} className="report-nav-group">
              <h2 className="pay-periods-head">{CATEGORY_LABEL[c]}</h2>
              {reports.filter((r) => r.category === c).map((r) => (
                <button key={r.key} type="button" className={`report-nav-item ${r === report ? "report-nav-on" : ""}`} aria-current={r === report ? "page" : undefined} onClick={() => choose(r.key)}>{r.title}</button>
              ))}
            </div>
          ))}
        </nav>
        <ReportPanel key={report.key} report={report} query={query} setQuery={setQuery} viewerName={displayName(me)} viewer={viewer} />
      </div>
    </div>
  );
}

function ReportPanel({ report, query, setQuery, viewerName, viewer }: { report: ReportDef; query: Query; setQuery: React.Dispatch<React.SetStateAction<Query>>; viewerName: string; viewer: ReturnType<typeof viewerFor> }) {
  const db = useDb();
  const day = today();
  const nowIso = new Date().toISOString();
  const params = useMemo(() => parseParams(db, day, query), [db, day, query]);
  const out = useMemo(() => runReport(db, report.key, viewer, params, nowIso), [db, report.key, viewer, params]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!out.ok) return <section className="panel">{out.message}</section>;
  const r = out.result;
  const set = (k: string, v: string | undefined) => setQuery((q) => ({ ...q, [k]: v || undefined }));
  const has = (f: FilterKey) => report.filters.includes(f);

  const download = () => {
    const blob = new Blob([toCsv(r)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = csvFilename(report.key, r.scope, nowIso);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <section className="report" aria-labelledby="report-title">
      <div className="report-head">
        <div>
          <h2 id="report-title">{report.title}</h2>
          <p className="muted">{report.description}</p>
          <p className="report-scope">{r.scope}{out.access === "team" ? " · Your direct reports" : ""}</p>
        </div>
        <div className="report-actions no-print">
          <Button icon="download" onClick={download} disabled={!r.rows.length}>Export CSV</Button>
          <Button icon="file" onClick={() => window.print()}>Print or save as PDF</Button>
        </div>
      </div>
      <p className="print-only small">Generated {formatDate(day)} by {viewerName}.</p>

      <Filters report={report} params={params} set={set} has={has} />

      {r.kpis && r.kpis.length > 0 && <div className="kpis">{r.kpis.map((k) => <KpiTile key={k.label} {...k} />)}</div>}
      {r.charts && r.charts.length > 0 && <div className="viz-charts">{r.charts.map((c) => <ChartView key={c.title} chart={c} />)}</div>}

      {r.rows.length === 0 ? <p className="muted report-empty">Nothing matches these filters.</p> : (
        <div className="table-wrap report-table">
          <table className="table">
            <thead><tr>{r.columns.map((c) => <th key={c.key} className={numericKinds.includes(c.kind) ? "num" : ""}>{c.label}</th>)}</tr></thead>
            <tbody>
              {r.rows.slice(0, 500).map((row, i) => (
                <tr key={i}>{r.columns.map((c) => <td key={c.key} className={numericKinds.includes(c.kind) || c.kind === "date" ? "num" : ""}>{formatValue(row[c.key], c.kind)}</td>)}</tr>
              ))}
            </tbody>
            {r.totals && <tfoot><tr>{r.columns.map((c) => <td key={c.key} className={numericKinds.includes(c.kind) ? "num" : ""}>{formatValue(r.totals![c.key], c.kind)}</td>)}</tr></tfoot>}
          </table>
          {r.rows.length > 500 && <p className="muted small">Showing the first 500 of {r.rows.length} rows. Export CSV for all of them.</p>}
        </div>
      )}
      {(r.notes?.length || report.sources?.length) ? (
        <div className="report-notes">
          {r.notes?.map((n) => <p key={n} className="muted small">{n}</p>)}
          {report.sources?.length ? <p className="muted small">Sources: {report.sources.map((s, i) => <span key={s.url}>{i ? "; " : ""}<a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>)}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function Filters({ report, params, set, has }: { report: ReportDef; params: ReturnType<typeof parseParams>; set: (k: string, v: string | undefined) => void; has: (f: FilterKey) => boolean }) {
  const db = useDb();
  const day = today();
  const months = [...new Set(db.payroll_periods.map((p) => p.start_date.slice(0, 7)))].sort().reverse();
  const years = [Number(day.slice(0, 4)), Number(day.slice(0, 4)) - 1];
  const presetOf = () => (params.to === day ? [7, 30, 90, 365].find((d) => params.from === addDays(day, -d)) : undefined);
  return (
    <div className="filters report-filters no-print" role="group" aria-label="Filters">
      {has("range") && (
        <>
          <label className={`filter ${presetOf() ? "" : "filter-on"}`}>
            <span className="sr-only">Date range</span>
            <select value={presetOf() ?? ""} onChange={(e) => { const d = Number(e.target.value); if (d) { set("from", addDays(day, -d)); set("to", day); } }}>
              {!presetOf() && <option value="">Custom range</option>}
              <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option>
            </select>
          </label>
          <label className="date-filter"><span className="sr-only">From</span><input type="date" value={params.from} max={params.to} onChange={(e) => set("from", e.target.value)} /></label>
          <span className="muted small">to</span>
          <label className="date-filter"><span className="sr-only">To</span><input type="date" value={params.to} min={params.from} onChange={(e) => set("to", e.target.value)} /></label>
        </>
      )}
      {has("as_of") && <label className="date-filter"><span className="small muted">As of</span><input type="date" value={params.as_of} onChange={(e) => set("as_of", e.target.value)} /></label>}
      {has("period") && (
        <FilterSelect label="Payroll period" value={params.period_id ?? ""} allLabel="Latest finalized" onChange={(v) => set("period_id", v)}
          options={[...db.payroll_periods].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((p) => ({ value: p.id, label: `${formatDate(p.start_date)} to ${formatDate(p.end_date)}${p.status === "open" ? " (open)" : ""}` }))} />
      )}
      {has("month") && <FilterSelect label="Month" value={params.month} allLabel={monthName(params.month)} onChange={(v) => set("month", v)} options={months.map((m) => ({ value: m, label: monthName(m) }))} />}
      {has("year") && <FilterSelect label="Year" value={String(params.year)} allLabel={String(params.year)} onChange={(v) => set("year", v)} options={years.map((y) => ({ value: String(y), label: String(y) }))} />}
      {has("org") && (
        <>
          {db.departments.length > 0 && <FilterSelect label="Departments" value={params.department_id ?? ""} onChange={(v) => set("department_id", v)} options={db.departments.map((d) => ({ value: d.id, label: d.name }))} />}
          {db.locations.length > 0 && <FilterSelect label="Branches" value={params.location_id ?? ""} onChange={(v) => set("location_id", v)} options={db.locations.map((l) => ({ value: l.id, label: l.name }))} />}
          {db.clients.filter((c) => !c.archived_at).length > 0 && <FilterSelect label="Clients" value={params.client_id ?? ""} onChange={(v) => set("client_id", v)} options={db.clients.filter((c) => !c.archived_at).map((c) => ({ value: c.id, label: c.name }))} />}
        </>
      )}
      {has("group_by") && (
        <label className="filter">
          <span className="sr-only">Group by</span>
          <select value={params.group_by} onChange={(e) => set("group_by", e.target.value)}>
            <option value="department">By department</option><option value="branch">By branch</option><option value="client">By client</option>
          </select>
        </label>
      )}
      {has("q") && <SearchInput label={`Search ${report.title.toLowerCase()}`} value={params.q ?? ""} onChange={(v) => set("q", v)} placeholder="Search people, records, notes" />}
    </div>
  );
}
