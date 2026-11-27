# Payroll compliance audit

November 2026. This reviews the payroll engine (`lib/payroll.ts`) against Philippine labor, contribution and tax rules. It lists what was wrong before this review, what is now fixed, what the company has to decide, and what is still not covered. Rules and sources are in [payroll rules](payroll-rules.md).

> **Bottom line.** Pay for time, holidays, overtime, night work, contributions and withholding tax now follow the rules listed in [payroll rules](payroll-rules.md). Every edge case below has an automated test (`npm test`, 67 tests). Leave, year-end annualization, final pay and regional minimum wages are now built too. Still missing before real payroll: remittance reports and BIR file formats, double holidays, and hazard pay and service charges. A Philippine payroll accountant also needs to sign off on the items marked "verify".

## What was wrong, and is now fixed

| # | Area | Problem | Fix | Effect if left |
| --- | --- | --- | --- | --- |
| 1 | Night differential | NSD was 10% of the plain hourly rate, even for overtime, rest day or holiday hours. | NSD is now 10% of the rate that applies to those hours (Art. 86). | Underpayment |
| 2 | Holiday eligibility | A holiday on the first day of a cutoff assumed the person was present the day before. | Presence is now checked on the last workday before the holiday, even if that was in the previous cutoff. | Overpayment |
| 3 | Successive holidays | Someone absent before Maundy Thursday who worked it still lost Good Friday pay. | If the employee works the first holiday, the second is paid (IRR of Art. 94). | Underpayment |
| 4 | Shifts across midnight | A 10 PM shift into a holiday was all treated as the start date. | Hours are split at midnight and each part takes the type of the date it falls on. | Wrong premium |
| 5 | SSS basis | SSS used the monthly rate only, but the law counts all compensation, including overtime and commissions. | Now a setting. The default is actual compensation: the first cutoff is estimated and the second trues it up. | Under-remittance |
| 6 | Long absences | Missing a whole cutoff made gross pay negative. | Time-not-worked deductions are capped at basic pay. | Negative pay |
| 7 | Joiners | Someone who joined in the second half of a month paid only half a month of contributions. | They pay the whole month on the second cutoff. | Under-remittance |
| 8 | Minimum wage earners | They were fully tax-exempt even with other taxable income, such as allowances or commissions. | The minimum wage, holiday pay, overtime and NSD stay exempt; other taxable income is taxed. | Under-withholding |
| 9 | Managerial staff | Late, undertime and missed-holiday deductions applied to managers, who are outside the hours-of-work rules (Art. 82). | These are off by default and can be turned on. Absences are still unpaid. | Over-deduction |
| 10 | No pay in a cutoff | Contributions were taken even when nothing was earned. | Contributions are skipped, with a note. | Negative net |
| 11 | 13th month | It was only an estimate. | It is now computed under PD 851, added to the December 1–15 payroll, and counted toward the ₱90,000 limit. | Missed payment |
| 12 | De minimis | The ceilings weren't modelled. | The new RR 29-2025 ceilings are in. Any excess counts toward the ₱90,000 limit. | Tax errors |
| 13 | Fixed constants | The 261 divisor and the NCR minimum wage were hard-coded. | Both are company settings. | Wrong rates for 6-day weeks |

## Company settings (Payroll → Payroll settings)

These vary from company to company. The law allows each choice; the defaults are shown in bold.

| Setting | Options | Notes |
| --- | --- | --- |
| When contributions are deducted | **Half each cutoff**, all on the 16th–end cutoff, or all on the 1st–15th cutoff | The law sets the monthly amount. The timing is up to the company. |
| SSS and Pag-IBIG basis | **Actual compensation** or monthly rate | Actual compensation matches RA 11199. The monthly rate is simpler but can under-remit. |
| Company pays the employee share | Off, per agency (SSS, PhilHealth, Pag-IBIG) | Common for executives. The shouldered share is treated as taxable compensation (**verify**). |
| Daily-rate divisor | **261**, 313 or 365 | 261 for a 5-day week, 313 for a 6-day week, 365 if every day is paid. |
| Unworked special days | **Paid** or unpaid | The law says no work, no pay. Paying them is a company benefit. |
| Late and undertime for managers | **Off** or on | Art. 82. |
| 13th month for managers | **On** or off | PD 851 covers rank-and-file staff. |
| Minimum wage | **₱755, NCR-28** | Set it per wage order. |

## Per-employee settings (Profile → Pay)

- Compensation: monthly or hourly, the rate, and whether the person is managerial.
- Who pays each employee share (the company setting, the employee, or the company).
- Voluntary Pag-IBIG savings on top of the mandatory ₱200. It's deducted after tax, because only the mandatory share is excluded from taxable pay.
- Allowances, benefits and deductions (below).

## Other earnings and deductions

Companies create their own pay types under **Payroll → Pay types**. Each type is filed under one of the legal treatments below, which decides its tax and SSS handling. Earning types can go to everyone, to rank-and-file staff or to managers automatically, with per-person overrides. See [the payroll module](modules/payroll.md#settings-allowances-and-deductions).

| Type | Tax treatment | Counts for SSS | Rule |
| --- | --- | --- | --- |
| Taxable allowance (transport, communication, not liquidated) | Taxable | Yes | NIRC Sec. 32 |
| De minimis (rice, laundry, medical, uniform, gifts, awards, CBA, OT meals) | Tax-free up to the ceiling; the excess goes to the ₱90,000 pool | No | RR 29-2025 |
| Bonus or other benefit | Tax-free within ₱90,000 a year, together with the 13th month | No | RA 10963 |
| Commission | Taxable | Yes | RA 11199 "compensation" |
| Reimbursement (liquidated, with receipts) | Not income | No | Not compensation |
| Pay adjustment | Taxable | Yes | |
| SSS or Pag-IBIG loan | Deducted without separate consent | | Art. 113: authorized by law |
| Company loan or cash advance | Needs a signed authorization | | DO 195-18 |
| Union dues | Needs a check-off authorization; excluded from taxable pay | | Art. 113; NIRC 32(B)(7)(f) |
| Insurance premium | Needs written consent | | Art. 113 |
| Loss or damage | Needs due process; capped at 20% of wages | | Arts. 114–115 |
| Other authorized deduction | Needs a signed authorization; the company can't benefit | | Art. 113, DO 195-18 |

A deduction that needs an authorization isn't taken until one is on file, and the payslip says so. When pay can't cover every deduction, they are taken in a fixed order: statutory loans, union dues, insurance, company loans, others, then loss or damage. Whatever is left carries to the next cutoff, and net pay never goes below zero. There are no fines for being late: only the actual minutes are deducted.

## Edge cases covered by tests

See `tests/payroll.test.ts`. Each line is one test.

- Attendance:
  - full attendance
  - late within and past the grace period
  - absence
  - a whole cutoff absent
  - no time out
  - a correction overriding a device record
- Overtime:
  - unapproved
  - approved but only partly worked
  - pending or rejected
  - undertime not offset by overtime (Art. 88)
  - rest day first 8 hours and beyond
  - night differential on overtime
- Holidays:
  - unworked, present or absent the day before
  - Monday holiday after an absent Friday
  - successive holidays
  - a holiday on the first day of a cutoff
  - hourly staff
  - regular and special premiums
  - special working days
  - the unworked special day setting
  - a night shift crossing into a holiday
- Managers: no overtime or premiums, and the tardiness setting.
- Contributions:
  - SSS brackets
  - PhilHealth floor and ceiling
  - Pag-IBIG cap and the low-pay rate
  - each timing option
  - the actual-compensation true-up
  - a joiner in the second half
  - a company-paid share
  - voluntary Pag-IBIG
  - the 313 divisor
- Tax:
  - table boundaries
  - minimum wage earner with and without other income
  - the below-minimum-wage flag
- Benefits:
  - de minimis within and over the ceiling
  - the ₱90,000 pool
  - reimbursements
- Deductions:
  - authorization required
  - carry-over when pay runs out
  - the 20% loss and damage cap
  - loan installments ending
- 13th month:
  - the amount, and proration
  - under one month of service
  - added to the December payroll
  - the managers setting

- Leave, employment terms, final pay and year-end tax:
  - paid leave isn't an absence; leave without pay is deducted
  - a paid half day covers leaving at 1 PM
  - paid leave before a regular holiday keeps the holiday paid
  - monthly accrual and the six-month wait
  - statutory leave isn't prorated; SIL is replaced by vacation leave of 5+ days
  - leave can only use credits earned by its first day
  - probation without written standards, or past 180 days, is regular; casual after a year is regular
  - six months or more counts as a year of service
  - separation pay by reason (Art. 298–299)
  - retirement pay of 22.5 days a year (RA 7641)
  - the annual tax table
  - December annualization: refund for a December joiner, and the go-live year-to-date
  - December leave cash conversion with carry-over kept
  - regional minimum wage from the work location
  - final pay: pro-rated 13th month, leave cash, and only authorized loan balances

## Not covered yet

These are needed before real payroll runs.

Leave, year-end tax, final pay and regional minimum wages are now built. See [leave rules](leave-rules.md), [year-end tax](year-end-tax.md), [final pay](final-pay.md) and [employment terms](employment-rules.md).

1. **Other holiday cases.**
   - Two regular holidays on the same date (300%).
   - Unworked regular holiday that falls on a rest day for daily-paid staff (**verify**).
   - Rest-day classification for night shifts that cross into a rest day. Only holidays are split at midnight.
2. **Other pay.** Hazard pay, service charges (RA 11360), COLA, and compressed workweek arrangements.
3. **Remittance.** SSS, PhilHealth and Pag-IBIG reports and due dates. Loan billing reconciliation.
4. **History.** Year-to-date figures (de minimis ceilings, the ₱90,000 pool, the 13th month base) only cover what's recorded in the app. Year-to-date figures from before go-live are imported as payroll openings (seeded for Manila staff through Oct 31, 2026); a screen to import them is still to build.

## Verify with a payroll accountant

- The tax treatment of employee shares the company pays. The app taxes them as compensation.
- The SSS compensation basis for allowances that are partly liquidated.
- The PhilHealth basis for hourly staff (the app uses the monthly equivalent of the rate).
- Unworked regular holidays on a rest day.
- Several rates come from secondary summaries (law firm and Big Four alerts). Confirm them against the official DOLE, BIR, SSS, PhilHealth and Pag-IBIG issuances.
