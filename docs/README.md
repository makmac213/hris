# Halden HRIS docs

All planning and documentation for the project lives here. Start with the roadmap if you want to know what's next, or a module page if you want to know how something works.

| Doc | What it covers |
| --- | --- |
| [Roadmap](roadmap.md) | What's built, what's next and the known gaps |
| [Architecture](architecture.md) | Code structure, the data layer and the plan for moving to Supabase |
| [REST API](api.md) | `/api/v1`: auth, API keys, conventions, resources and the rollout plan |
| [Design system](design-system.md) | Type, colour, shape, spacing and motion |
| [Design critique](design-critique.md) | Each review against impeccable.style, with the findings and fixes |
| [Payroll rules](payroll-rules.md) | Philippine labor and tax rules the payroll follows, with sources |
| [Payroll compliance audit](payroll-compliance-audit.md) | What was checked, what was fixed, company settings, edge cases tested, and what's still missing |
| [Leave rules](leave-rules.md) | Statutory leave as the floor, company leave on top, and how leave reaches payroll |
| [Employment terms](employment-rules.md) | Probationary, regular, project, seasonal, casual and fixed-term rules, and separation reasons |
| [Final pay](final-pay.md) | What's in final pay, separation and retirement pay, tax, notice and timing |
| [Year-end tax](year-end-tax.md) | Annualization, BIR 2316, 1601-C, 1604-C and substituted filing |
| [Time in and time out edge cases](time-punches.md) | Double taps, repeated punches, breaks, forgotten time outs, overnight shifts, offline devices, and how payroll counts each |
| [Payslips](payslips.md) | What employees see under My pay, printing, and why issued payslips never change |
| [Who approves requests](approvals.md) | Direct supervisor plus approver roles, for leave, overtime and corrections |
| [Organization and scheduling](scheduling.md) | Departments, branches, clients; the operations schedule, leave gaps, cover and notifications |
| [Loans and advances](loans.md) | SSS and Pag-IBIG loans, company loans and cash advances: balances, the ledger, requests, final pay and remittance |
| [Reports and audit trail](reports.md) | HR, executive, payroll and audit reports; who sees which; filters, CSV and PDF export, the API, and the audit log |

Modules:

| Module | Status |
| --- | --- |
| [Employee management](modules/employee-management.md) | Built (on `main`) |
| [Timekeeping](modules/timekeeping.md) | Built (PR #1) |
| [Payroll, overtime and corrections](modules/payroll.md) | Built (PR #2) |
| [Leave, employment terms, final pay and year-end tax](modules/leave-and-separation.md) | Built (PR #2) |
| [REST API](api.md) | Built (PR #3) |
| [Organization and scheduling](scheduling.md) | Built (`feature/scheduling`) |
| [Loans and advances](loans.md) | SSS and Pag-IBIG loans, company loans and cash advances: balances, the ledger, requests, final pay and remittance |
| [Reports and audit trail](reports.md) | Built (`feature/reports`) |
| [Loans and advances](loans.md) | Built (`claude/project-thread-g7qxli`) |

Write new planning docs here too: one file per topic, linked from this page.
