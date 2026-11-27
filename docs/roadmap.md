# Roadmap

## Built

| Phase | Scope | Where |
| --- | --- | --- |
| 1 | Employee directory, profiles, org chart, onboarding | `main` |
| 2 | Shift codes, Record Time (time, live photo, GPS), attendance | PR #1 |
| 3 | Payroll (PH rules), overtime requests, time correction requests, approvals, payslips | PR #2 |

## Next

- **Supabase:** auth, persistence, RLS, storage for photos, server-side payroll. See [architecture](architecture.md#moving-to-supabase).
- **Leave:** service incentive leave (Art. 95), leave requests and balances, leave pay in payroll, paid leave counting as "present" for regular holidays.
- **Payroll completeness:** allowances, de minimis, loans and other deductions; 13th month pay run; annualized tax at year end and BIR 2316; final pay; bank file export; payslip PDF.
- **Scheduling:** shift rotations and rest days other than weekends; per-employee holiday calendars by location; regional minimum wages beyond NCR.
- **Timekeeping:** geofencing against office locations, liveness or face match on the photo.
- **Audit log** for every change to records, requests, compensation and payroll.
- **Imports:** employees and compensation from CSV.

## Known gaps in the prototype

No persistence (a reload resets the data), no real sign-in (roles come from the switcher), and the payroll rules need sign-off from a Philippine payroll accountant before real use (see [payroll rules](payroll-rules.md)).
