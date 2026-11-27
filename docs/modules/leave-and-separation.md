# Leave, employment terms, final pay and year-end tax

Built on top of payroll in PR #2. Philippine law is the floor everywhere, and company policy adds on top.

## Screens

| Screen | Who | What |
| --- | --- | --- |
| My leave (`/my-leave`) | Everyone on the Philippine payroll | Balances for the year, leave for specific situations, a request form with live checks, and their requests |
| Approvals (`/approvals`) | Managers and HR | Leave requests sit next to overtime and corrections. Each shows the balance after approval, who the leave is for, and the documents to check. |
| Leave policies (`/leave`) | Admin and HR | Company leave and statutory leave. Statutory leave can be made more generous, never less. |
| Profile → Leave | HR, and the person | Balances, and HR can adjust them with a reason |
| Profile → Employment | HR | Status on file and in law, probation and contract dates, alerts, Regularize, Record separation with a live final pay statement |
| Payroll → Year-end tax (`/payroll/year-end`) | Admin and HR | Annualization per person, 2316 figures, monthly 1601-C totals, deadlines |
| Payroll settings | Admin and HR | Regional minimum wage by work location, with the table of wage orders |
| Payroll page | Admin and HR | Employment alerts, and the minimum wage check per person's region |

## Code

- `lib/leave.ts`: statutory leave, balances, accrual, carry-over, conversion, validation.
- `lib/employment.ts`: status rules, service years, alerts.
- `lib/finalpay.ts`: final pay, separation pay, retirement pay.
- `lib/yearend.ts`: annual tax table, year-to-date, annual summary, deadlines.
- `lib/regions.ts`: regional daily minimum wages.
- `lib/payroll.ts`: leave in the day calculation, December leave cash conversion and annualization.

## Data

New tables, in `supabase/migrations/0004_leave_and_separation.sql`:

- `leave_types`
- `leave_requests`
- `leave_adjustments`
- `payroll_openings`

New columns: employment terms on `employees`, and `ph_region` on `locations`.

## Rules

- [Leave rules](../leave-rules.md)
- [Employment terms](../employment-rules.md)
- [Final pay](../final-pay.md)
- [Year-end tax](../year-end-tax.md)
