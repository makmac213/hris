# Reports

Plan and reference for the reports module: HR reports, an executive dashboard, payroll and statutory reports, and audit reports. Each one works in the web app (**Reports**) and in the API (`GET /reports/{key}`), with the same filters, the same numbers and CSV export. Any report prints, or saves as a PDF, from the browser.

## Who sees what

| Report | Admin | HR | Executive | Operations | Manager (anyone with reports) | API key `reports:read` |
| --- | --- | --- | --- | --- | --- | --- |
| Executive dashboard | Yes | Yes | Yes | | | Yes |
| Headcount, Turnover | Yes | Yes | Yes | | | Yes |
| Attendance, Tardiness, Leave usage | Yes | Yes | | Yes | Their direct reports | Yes |
| Probation and regularization | Yes | Yes | | | | Yes |
| Payroll register, Contributions, Withholding tax, Alphalist, 13th month | Yes | Yes | | | | Yes |
| Approvals history, Corrections history | Yes | Yes | | | | Yes |
| Audit trail | Yes | | | | | |

- **Executive** is a new role. It can see aggregates (headcount, turnover, cost by group), but not anyone's payslip, pay rate or HR record.
- **Audit trail** is limited to admin, so that HR's own changes are reviewed by someone else. API keys can't read it either.
- **Managers** only ever see their direct reports in these reports. Pay reports stay with admin and HR, the same as payslips.

## Filters

Every report lists the filters it uses, and the filters sit in one row above the report. Filters that don't apply aren't shown.

| Filter | Query parameter | Used by |
| --- | --- | --- |
| Date range | `from`, `to` (default: the last 30 days up to today; attendance counts only days that are over) | Attendance, tardiness, leave usage, turnover, approvals, corrections, audit trail |
| As of | `as_of` (default: today) | Headcount, probation, executive dashboard |
| Payroll period | `period_id` (default: the latest finalized) | Payroll register |
| Month | `month`, as `YYYY-MM` | Contributions, withholding tax |
| Year | `year` | Alphalist, 13th month |
| Department, branch, client | `department_id`, `location_id`, `client_id` | People-based reports |
| Group by | `group_by`: `department`, `branch` or `client` | Headcount, turnover, executive dashboard |
| Search | `q` | Audit trail, approvals, corrections |

## The reports

### HR

- **Headcount:** active people on a date, by group, with hires and separations per month for the last 12 months.
- **Turnover:** separations in the range, the rate (separations divided by average headcount), and the split by reason (voluntary or involuntary).
- **Attendance:** per person, the scheduled days, days present, days absent, days on leave and the attendance rate, plus late arrivals, undertime and days with no time out. It uses the schedule, approved leave and time records, the same way payroll does.
- **Tardiness:** late arrivals and late minutes per person, worst first, with late minutes by group.
- **Leave usage:** approved and pending days by leave type, and by department.
- **Probation and regularization:** everyone on probation, with the day probation ends (six months at most, Labor Code Art. 296) and whether standards were made known when they were hired. It also lists regularizations due in the next 60 days and recent ones.

### Executive

- **Executive dashboard:** KPI tiles for headcount and its change over 12 months, the 12-month turnover rate, the attendance rate over the last 30 days, late arrivals per 100 shifts, leave days taken this year, the latest payroll cost (gross plus employer contributions), overtime hours and open shift-cover gaps.
- **Charts:** headcount over 12 months, hires and separations, payroll cost by group, and attendance by group.
- **Table:** one row per group.

### Payroll and statutory

- **Payroll register:** per person for a period, with gross, contributions, tax, other deductions, net pay and employer cost. Finalized periods use the issued payslips ([payslips.md](payslips.md)).
- **Contributions (remittance):** per person for a month, both cutoffs together. It shows SSS employee share and employer share (including EC), PhilHealth employee and employer shares, and Pag-IBIG employee and employer shares, with totals to remit. When the company pays the employee share, it still counts as the employee share owed.
- **Withholding tax (BIR 1601-C figures):** per person for a month, with total compensation, non-taxable pay, taxable pay and tax withheld.
- **Alphalist (BIR 1604-C, annual):** per person for a year, with the annualized figures from [year-end tax](year-end-tax.md). It covers gross, non-taxable, mandatory contributions, taxable, tax due, tax withheld, the December adjustment, minimum wage earner status and substituted filing.
- **13th month:** per person for a year, under PD 851. It shows the amount, the tax-free part (up to ₱90,000 together with other benefits) and the deadline, December 24.

These reports give the figures that go into each form. They aren't the BIR, SSS, PhilHealth or Pag-IBIG file formats themselves (see "Not yet").

### Audit

- **Audit trail:** who changed what and when, field by field. Every change made in the web app or the API is logged with the person (or API key), the time, the record and the old and new values. Photos and other large values are shortened. In Postgres a trigger writes the same log for every change (migration 0010), so a change made outside the app is caught too.
- **Approvals history:** every leave, overtime and correction request. It shows who filed it, when, who decided it, how long that took, the outcome and the note.
- **Corrections history:** every time correction. It shows the original time, the corrected time, who approved it and why.

## Export

- **CSV:** the Export CSV button, or `format=csv` on the API. One row per table row, with the filters and the time it was generated in the file name. Money is a plain number with two decimals. Text that starts with `=`, `+`, `-` or `@` is prefixed with `'`, so a spreadsheet won't run it as a formula.
- **PDF:** Print or save as PDF prints the report header, the filters, the KPIs, the charts and the table. It leaves out the app's sidebar and controls.

## API

| Endpoint | What it does | Who |
| --- | --- | --- |
| `GET /reports` | The reports the caller can run, with their filters | Anyone |
| `GET /reports/{key}` | Run a report. Filters as query parameters. Returns `columns`, `rows`, `totals`, `kpis`, `charts` and `notes`. `format=csv` returns `text/csv`. | See the table above |

## Charts

The charts follow the dataviz method:

- **One series:** a single hue with no legend.
- **Two series:** blue and orange in a fixed order, with a legend. That pair passed the palette validator in light and dark modes.
- **Hover:** a crosshair tooltip on line charts, and a tooltip on each bar.
- **Data table:** under every chart. The light-mode orange is below 3:1 contrast, and the table is the relief for that.
- **No dual axes, and text never takes the series color.**

## Code

- `lib/reports/`: one file per category, plus `index.ts` (the registry and access rules) and `csv.ts`.
- `lib/audit.ts`: the change log.
- `features/reports/ReportsView.tsx` and `components/charts.tsx`.
- `supabase/migrations/0010_reports_and_audit.sql`: the `executive` role, the `audit_log` table (append only), the audit trigger on every business table, and the `reports:read` scope. The API sets `app.actor_id` and `app.actor_label` per request so the trigger can name the person or API key; a signed-in person falls back to `auth.uid()`. Migrations 0001 to 0010 were applied to a local Postgres 16 to check them, and the trigger was tested for a create, an update, a no-op update (not logged) and an attempt to edit the log (refused).
- Fixed in passing: migration 0003 named a column `authorization`, a reserved word in Postgres, so it failed to apply. It is now quoted. The app's field name is unchanged.

## Not yet

- The official upload formats: the SSS R-3, the PhilHealth RF-1, the Pag-IBIG MCRF, and the BIR alphalist DAT file and eFPS.
- Scheduled reports by email.
- Saved filters.
- Reports over imported history from before the app.
