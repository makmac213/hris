# Year-end tax

Withholding each cutoff uses the semi-monthly table, which assumes the same pay all year. Real pay varies: overtime, bonuses, joiners, leavers and benefits over the tax-free limits. The last payroll of the year corrects this by **annualizing**. Code: `lib/yearend.ts`. Screen: **Payroll → Year-end tax**.

## Annualization

The December 16–31 payroll does the following (RR 2-98 Sec. 2.79(B)(5)):

1. Adds up the year's **taxable compensation**:
   - figures imported at go-live (`payroll_openings`),
   - every cutoff run in the app,
   - and this cutoff.
2. Computes the **tax due** with the annual table.
3. Withholds **tax due − tax already withheld**. A negative result is a refund of excess withholding, added to pay.

Someone who leaves mid-year is annualized in their [final pay](final-pay.md) instead.

### Annual table, 2023 onward (NIRC Sec. 24(A)(2) as amended by RA 10963)

| Taxable income | Tax |
| --- | --- |
| Up to ₱250,000 | 0 |
| Over ₱250,000 to ₱400,000 | 15% of the excess over ₱250,000 |
| Over ₱400,000 to ₱800,000 | ₱22,500 + 20% of the excess over ₱400,000 |
| Over ₱800,000 to ₱2,000,000 | ₱102,500 + 25% of the excess over ₱800,000 |
| Over ₱2,000,000 to ₱8,000,000 | ₱402,500 + 30% of the excess over ₱2,000,000 |
| Over ₱8,000,000 | ₱2,202,500 + 35% of the excess over ₱8,000,000 |

### Not taxable

- 13th month and other benefits up to ₱90,000 a year.
- De minimis benefits within their ceilings (RR 29-2025).
- Employee shares of SSS, PhilHealth and Pag-IBIG, and union dues.
- For minimum wage earners, the minimum wage itself, plus holiday pay, overtime, night differential and hazard pay.

## Returns and deadlines

| Form | What | Due |
| --- | --- | --- |
| 1601-C | Monthly remittance of tax withheld on compensation | 10th of the next month (eFPS filers up to the 15th, by industry group). December's carries the year-end adjustment. |
| 2316 | Certificate of compensation and tax withheld, one per employee | January 31. On the day of separation for leavers. |
| 1604-C | Annual information return, with the alphalist of employees | January 31 |
| Duplicate 2316s | Signed copies for employees under substituted filing | February 28 |

**Substituted filing** (RR 11-2018): an employee with only one employer for the whole year, whose tax was withheld correctly, doesn't file BIR Form 1700. Their signed 2316 counts as the return. The Year-end tax page marks people who joined this year. Ask them about previous employers, and get the previous employer's 2316 to include in the annualization.

## What the screen shows

- **One row per employee:**
  - gross, non-taxable and taxable compensation;
  - tax due and tax withheld to December 15;
  - the December 16–31 adjustment (collect or refund);
  - the 2316 figures in a dialog.
- **Monthly 1601-C totals.**
- **The deadlines.**

Cutoffs that are still in the future are projected from schedules. The page says they are estimates until December is paid.

## Go-live

Companies that start mid-year import each person's year-to-date figures as `payroll_openings`:

- taxable compensation,
- tax withheld,
- non-taxable benefits already paid,
- mandatory contributions,
- basic pay,
- 13th month paid.

Without them, annualization and the ₱90,000 pool would only see what was paid in the app.

## Sources

- Annual tax table under TRAIN: [BIR](https://www.bir.gov.ph/index.php/tax-information/income-tax.html)
- RR 2-98 as amended (withholding on compensation, annualization): [BIR](https://www.bir.gov.ph/index.php/revenue-issuances/revenue-regulations.html)
- RR 11-2018 (TRAIN withholding, substituted filing): [BIR](https://www.bir.gov.ph/images/bir_files/internal_communications_1/Full%20Text%20RR%202018/RR%20No.%2011-2018.pdf)
- RR 29-2025 (de minimis ceilings): [PwC tax alert](https://www.pwc.com/ph/en/tax/tax-publications/tax-alerts/2026/tax-alert-02.html)
