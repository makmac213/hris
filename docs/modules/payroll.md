# Payroll, overtime and corrections

Status: built (PR #2). Rules and sources are in [payroll rules](../payroll-rules.md).

## How pay is worked out

1. **The shift code is the schedule.** For each day, only time inside the schedule counts as worked time, net of the meal break.
2. **Late, undertime and absence** are deducted from monthly basic. Hourly staff are paid for the minutes worked.
3. **Overtime is never automatic.** Time outside the schedule is paid only when an overtime request for it was approved, and only the minutes the time records show were actually worked. Unapproved extra time of 30 minutes or more is flagged on the payslip but not paid.
4. **Premiums** apply for rest days, special days and regular holidays, and night differential for 10 PM to 6 AM. Managerial staff get none of these (Art. 82).
5. **Contributions** (SSS, PhilHealth, Pag-IBIG) are computed monthly and split across the two cutoffs; **withholding tax** uses the semi-monthly table. Minimum wage earners pay no withholding tax.

## Requests

| Request | Who files | What it does when approved |
| --- | --- | --- |
| Overtime | The employee, for a date and a from–to time outside their schedule, with a reason | Makes that time payable, up to what the time records cover |
| Time correction | The employee: missing time in, missing time out, wrong time in, wrong time out | Adds a correction record; the original stays on file |

Filing rules: no future dates or times, no dates in a finalized period, up to 12 hours of overtime, no overlap with the schedule or with another request, a reason of at least a sentence, and managerial staff can't file overtime.

Approvals (`/approvals`): admin and HR see everyone; managers see their direct reports. Nobody approves their own request. Overtime requests show how much of the time the records cover; corrections show the original record. Rejecting needs a note.

## Screens

| Screen | Route | Who |
| --- | --- | --- |
| My time | `/my-time` | Everyone: record time, request a fix on any recent day, file overtime, see and withdraw requests |
| Approvals | `/approvals` | Admin, HR, managers |
| Payroll | `/payroll` | Admin, HR: period tabs, totals, checks before finalizing, the register, each payslip, the rules with sources |
| My pay | `/my-pay` | Everyone on Philippine payroll: payslips by period, with every line explained and a day-by-day breakdown |

**Finalizing a period** is blocked until the period has ended, no requests in it are pending, and nobody is below the minimum wage. Once finalized, the period is locked: no requests can be filed for its dates.

## Sample data

Compensation is set for the 14 Manila staff (three managerial, one hourly). The seed includes late days, an absence, undertime, a forgotten time out, approved, pending and rejected overtime, approved and pending corrections, a rest-day shift, special-day work and a night shift. The previous period is finalized and paid; the current one is open.

Schema: `0003_payroll.sql` (compensation, holidays, overtime_requests, time_correction_requests, payroll_periods, payroll_items, and `time_records.source`).
