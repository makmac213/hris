# Roadmap

## Built

| Phase | Scope | Where |
| --- | --- | --- |
| 1 | Employee directory, profiles, org chart, onboarding | `main` |
| 2 | Shift codes, Record Time (time, live photo, GPS), attendance | PR #1 |
| 3 | Payroll (PH rules), overtime requests, time correction requests, approvals, payslips, payroll settings, allowances and deductions, 13th month, compliance audit with tests | PR #2 |
| 3b | Company-defined pay types; leave (statutory floor plus company policies); employment terms and alerts; regional minimum wages; year-end annualization, 2316 and 1601-C figures; final pay with separation and retirement pay | PR #2 |
| 3c | REST API `/api/v1` | PR #3 |
| 4 | Departments, branches and clients; operations schedule with rotating rest days, leave gaps, cover and notifications; schedule drives attendance, leave days and payroll; approvals by direct supervisor plus configurable approver roles | `feature/scheduling` |
| 5 | Reports: HR (headcount, turnover, attendance, tardiness, leave, probation), executive dashboard, payroll (register, SSS, PhilHealth and Pag-IBIG contributions, withholding, alphalist, 13th month), audit (audit trail, approvals, corrections); CSV and PDF export; the reports API | `feature/reports` |

## Next

- **REST API** (`/api/v1`): built against the in-memory store. Next, connect Supabase, then move the web screens onto the same services. See [api.md](api.md).

- **Supabase:** auth, persistence, RLS, storage for photos, server-side payroll. See [architecture](architecture.md#moving-to-supabase).
- **Payroll completeness:** official remittance file formats for SSS, PhilHealth and Pag-IBIG; BIR file formats (1601-C, alphalist DAT files, 2316 PDF); double holidays; hazard pay and service charges; a go-live import screen for year-to-date figures; bank file export; payslip PDF. Full list in the [compliance audit](payroll-compliance-audit.md#not-covered-yet).
- **Leave:** maternity leave SSS reimbursement tracking; leave calendars for teams; half-day morning or afternoon choice.
- **Scheduling:** shift templates and swaps, headcount targets per client and hour, email or push notifications ([scheduling](scheduling.md#not-yet)); per-employee holiday calendars by location (local special days); wage order tiers below the regional maximum (by sector and establishment size).
- **Timekeeping:** geofencing against office locations, liveness or face match on the photo.
- **Reports:** official SSS R-3, PhilHealth RF-1 and Pag-IBIG MCRF files, BIR alphalist DAT files, scheduled email delivery, saved filters ([reports](reports.md#not-yet)).
- **Imports:** employees and compensation from CSV.

## Known gaps in the prototype

No persistence (a reload resets the data), no real sign-in (roles come from the switcher), and the payroll rules need sign-off from a Philippine payroll accountant before real use (see [payroll rules](payroll-rules.md)).
