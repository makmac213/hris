# Philippine payroll rules

> **Verify before go-live.** This is research for a prototype, compiled in November 2026. Rates change (wage orders, SSS schedules, holiday proclamations) and several items have exceptions not modelled here. Before Halden runs real payroll, have a Philippine payroll accountant or labor lawyer confirm every rule below, and re-check DOLE, BIR, SSS, PhilHealth and Pag-IBIG for updates. Every constant lives in one place, `RULES` in `lib/payroll.ts`, so a change is a one-line edit.

## The principle Mark set

Pay follows the **shift code**. Only time inside the employee's schedule is paid as regular time. Anything outside it (staying late, coming early, working a rest day) is paid only if the employee **files an overtime request and it is approved**. Mistakes in time records are fixed by filing a **time correction request**, never by editing a record. The original record stays on file and the approved correction is added next to it.

## Hours of work

| Rule | What the app does | Source |
| --- | --- | --- |
| Normal hours are 8 a day (Art. 83). | A whole-day shift is 9 hours with a 1-hour unpaid meal break (Art. 85), so 8 paid hours. Half-day shifts are 4 hours. | Labor Code (PD 442) Arts. 83, 85 |
| Managerial employees are not covered by the hours-of-work rules (Art. 82). | Compensation has `is_managerial`. They get no overtime, night differential or holiday premiums, and can't file overtime. | Art. 82 |
| Late and undertime are not worked, so not paid. | Deducted at the hourly rate, minute by minute. Arriving within the shift's grace period (default 5 minutes) is not late; past it, all the minutes count. | "No work, no pay" principle; Art. 83 |
| Undertime on one day can't be offset by overtime on another (Art. 88). | Undertime and overtime are computed and shown separately. | Art. 88 |
| A day with a time in but no time out is incomplete. | Unpaid for the missing part until a correction is approved; the payslip flags it. | Prototype policy |

## Premium pay

Multipliers are applied to the hourly rate. 2026 holiday rules follow DOLE Labor Advisory No. 12, s. 2025.

| Day | Worked, first 8 hours | Overtime | Not worked |
| --- | --- | --- | --- |
| Ordinary day | 100% | 125% (Art. 87) | No pay |
| Rest day | 130% (Art. 93) | 130% × 1.3 = 169% | No pay |
| Special non-working day | 130% | 169% | No pay, unless company policy says otherwise |
| Special day on a rest day | 150% | 195% | No pay |
| Regular holiday | 200% (Art. 94) | 260% | 100%, if present the workday before |
| Regular holiday on a rest day | 260% | 338% | 100% |
| Night shift differential, 10 PM to 6 AM | +10% of the hourly rate for that day (Art. 86) | | |

"Rest day" in the prototype is Saturday and Sunday. Shift rotations with other rest days are on the roadmap.

## Pay period and rates

| Rule | What the app does | Source |
| --- | --- | --- |
| Pay at least twice a month, no more than 16 days apart (Art. 103). | Semi-monthly: the 1st–15th is paid on the 20th; the 16th to month end is paid on the 5th. | Art. 103 |
| Daily rate for monthly-paid staff on a 5-day week. | Monthly × 12 ÷ 261. Hourly = daily ÷ 8. | DOLE Handbook on Workers' Statutory Monetary Benefits (factor 261) |
| Minimum wage, NCR: ₱755 a day from Sept 26, 2026. | Payroll flags anyone below it and blocks finalizing. Minimum wage earners are exempt from withholding tax. | Wage Order No. NCR-28 |
| Joiners and leavers. | Monthly basic is prorated by the workdays they were employed in the period. | Prototype policy |

## Government contributions (2026)

Computed monthly on basic pay and split evenly across the two cutoffs.

| Contribution | Employee | Employer | Base | Source |
| --- | --- | --- | --- | --- |
| SSS | 5% | 10% + EC (₱10 below ₱15,000 MSC, ₱30 at or above) | Monthly salary credit, ₱5,000–₱35,000 in ₱500 steps | RA 11199; SSS 2025 schedule |
| PhilHealth | 2.5% | 2.5% | 5% of basic, floor ₱10,000, ceiling ₱100,000 | RA 11223 (UHC Act) |
| Pag-IBIG | 2% (1% at ₱1,500 or less) | 2% | Fund salary up to ₱10,000 (so ₱200 each at most) | RA 9679; HDMF Circular 460 |

## Withholding tax

Semi-monthly table from RR 11-2018 (TRAIN, effective 2023 onward), applied to taxable pay = gross less the employee's contributions.

| Taxable pay per cutoff | Tax |
| --- | --- |
| ₱10,417 and below | 0 |
| Over ₱10,417 to ₱16,666 | 15% of the excess over ₱10,417 |
| Over ₱16,667 to ₱33,332 | ₱937.50 + 20% of the excess over ₱16,667 |
| Over ₱33,333 to ₱83,332 | ₱4,270.70 + 25% of the excess over ₱33,333 |
| Over ₱83,333 to ₱333,332 | ₱16,770.70 + 30% of the excess over ₱83,333 |
| ₱333,333 and above | ₱91,770.70 + 35% of the excess over ₱333,333 |

## 13th month pay

One twelfth of basic pay earned in the calendar year, due on or before December 24 (PD 851). Tax-free up to ₱90,000 together with other benefits (RA 10963). Payroll shows an estimate; paying it is on the roadmap.

## Not modelled yet

Service incentive leave (5 days, Art. 95), leave pay generally, de minimis benefits, allowances, loans and other deductions, annualized tax at year end, BIR 2316, final pay, rates for regions other than NCR, and small-establishment wage exemptions. See the [roadmap](roadmap.md).

## Sources

- [Labor Code of the Philippines (PD 442), Book III](https://lawphil.net/statutes/presdecs/pd1974/pd_442_1974.html)
- [Proclamation No. 1006, s. 2025: 2026 regular and special days](https://lawphil.net/executive/proc/proc2025/proc_1006_2025.html)
- [DOLE Labor Advisory No. 12, s. 2025: pay rules for 2026 holidays (Grant Thornton summary)](https://www.grantthornton.com.ph/technical-alerts/outsourcing-alert/2025/dole-labor-advisory-no-12-25/)
- [DOLE Labor Advisory No. 18, s. 2026: November holiday pay (People Matters)](https://sea.peoplemattersglobal.com/news/compensation-benefits/philippines-issues-pay-rules-for-november-holidays-52710)
- [Wage Order No. NCR-28: ₱755 minimum wage](https://laborcode.ph/755-minimum-wage-ncr-27/)
- [SSS contribution schedule](https://sweldoph.com/guides/sss-contribution)
- [PhilHealth 2026 contribution table](https://taxcalculator.com.ph/guides/philhealth-contribution-table-2026)
- [Pag-IBIG contribution](https://sweldoph.com/guides/pagibig-contribution)
- [BIR withholding tax table](https://www.pesohub.ph/government/bir/withholding-tax-table-philippines/)

Several sources are secondary summaries of the official issuance. Confirm against the DOLE, BIR, SSS, PhilHealth and Pag-IBIG originals before go-live.
