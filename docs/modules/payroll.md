# Payroll, overtime and corrections

Status: built (PR #2). Rules and sources are in [payroll rules](../payroll-rules.md).

## How pay is worked out

1. **The shift code is the schedule.** For each day, only time inside the schedule counts as worked time, net of the meal break.
2. **Late, undertime and absence** are deducted from monthly basic. Hourly staff are paid for the minutes worked.
3. **Overtime is never automatic.** Time outside the schedule is paid only when an overtime request for it was approved, and only the minutes the time records show were actually worked. Unapproved extra time of 30 minutes or more is flagged on the payslip but not paid.
4. **Premiums** apply for rest days, special days and regular holidays, and night differential for 10 PM to 6 AM. Managerial staff get none of these (Art. 82).
5. **Contributions** (SSS, PhilHealth, Pag-IBIG) are computed monthly and split across the two cutoffs; **withholding tax** uses the semi-monthly table. Minimum wage earners pay no withholding tax.

## Settings, allowances and deductions

**How flexible it is.** Every company defines its own pay types (Payroll → Pay types). The law is the floor: the company chooses which legal treatment a type falls under, and the law decides what that treatment means. The table shows what's configurable and where.

| What | Company decides | Fixed by law |
| --- | --- | --- |
| Allowances, benefits, bonuses, commissions | The name, default amount, schedule, who gets it (everyone, rank-and-file, managers, or person by person), whether it counts toward the 13th month, and active or not | How it's taxed and whether it counts for SSS, which follow from its legal treatment. De minimis can only be tax-free up to the RR 29-2025 ceiling. |
| Deductions (loans, coop, HMO, union dues…) | The name, default amount and schedule | Each needs the person's signed authorization, except SSS and Pag-IBIG loans. They're never applied company-wide. Loss or damage is capped at 20%. |
| Contributions | Timing, basis, whether the company pays the employee share (for everyone or per person), and voluntary Pag-IBIG | The rates, salary credits, floors and ceilings |
| Per person | Change a company-wide amount, exclude someone, or add any type with their own amount, schedule and installments | |

- **Payroll settings** (Payroll page, admin and HR): contribution timing, SSS basis, company-paid shares, daily-rate divisor, unworked special days, manager tardiness, 13th month for managers, minimum wage.
- **Profile → Pay** (admin and HR): compensation, who pays each employee share, voluntary Pag-IBIG, and pay items. Pay items cover allowances, de minimis benefits, bonuses, commissions, reimbursements, adjustments, SSS and Pag-IBIG loans, company loans, union dues, insurance and loss or damage. Deductions that need a signed authorization aren't taken without one. Items are stopped, never deleted, so past payslips stay explainable.
- **13th month** is added to the December 1–15 payroll automatically.

The [compliance audit](../payroll-compliance-audit.md) lists each rule, the edge cases tested, and what's still missing.

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
| My pay | `/my-pay` | Everyone on Philippine payroll: issued payslips by period, with every line explained, a day-by-day breakdown and print or save as PDF; the open period as an estimate ([payslips.md](../payslips.md)) |

**Finalizing a period** is blocked until the period has ended, no requests in it are pending, and nobody is below the minimum wage. Once finalized, the period is locked: no requests can be filed for its dates.

## Sample data

Compensation is set for the 14 Manila staff (three managerial, one hourly). Pay items include rice subsidies, a laundry allowance over its ceiling, a uniform allowance over its yearly ceiling, a transport allowance, a commission, a reimbursement, a bonus, SSS and Pag-IBIG loans, a company loan, an HMO premium, a cash advance with no authorization on file (so it isn't deducted), and an emergency advance. The CEO's employee shares are paid by the company, and Miguel saves extra in Pag-IBIG. The seed includes late days, an absence, undertime, a forgotten time out, approved, pending and rejected overtime, approved and pending corrections, a rest-day shift, special-day work and a night shift. The previous period is finalized and paid; the current one is open.

Schema: `0003_payroll.sql` (compensation, holidays, overtime_requests, time_correction_requests, payroll_periods, payroll_items, payroll_settings, employee_payroll_settings, pay_items, and `time_records.source`).

Tests: `npm test` runs 67 edge-case tests of the engine (`tests/payroll.test.ts`).
