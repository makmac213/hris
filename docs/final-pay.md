# Final pay

When someone leaves, the app builds a final pay statement from the last day and the reason. HR sees it live while recording the separation, and on the profile afterwards. Code: `lib/finalpay.ts`.

## What's in it

1. **Last cutoff, net.** Pay for the days worked in the last cutoff, less contributions and that cutoff's loan installments.
2. **13th month, pro rata.** One twelfth of basic pay earned from January 1 to the last day, less any 13th month already paid this year (PD 851).
3. **Unused convertible leave**, all of it, at the daily rate. Up to 12 days of vacation leave is tax-free (RR 29-2025).
4. **Separation pay**, by reason. See the table below.
5. **Retirement pay (RA 7641)** when the reason is retirement. The person must be 60 to 65 with at least 5 years of service.
   - The amount is 22.5 days' pay for each credited year: 15 days, plus 1/12 of the 13th month (2.5 days), plus 5 days of SIL.
6. **Remaining company loan balances.** These are deducted only when there's a signed authorization (Art. 113). Without one, the statement says so and leaves the balance out.
   - SSS and Pag-IBIG loan balances are listed separately for reporting to the agency.
7. **Tax adjustment.** The year is annualized up to the last day. Final pay often brings a refund, because withholding assumed a full year's pay.

## Separation pay by reason

A fraction of six months or more counts as a whole year.

| Reason | Separation pay | Tax |
| --- | --- | --- |
| Redundancy, labor-saving devices | 1 month per year of service, at least 1 month (Art. 298) | Exempt |
| Retrenchment, closure not due to losses | ½ month per year, at least 1 month (Art. 298) | Exempt. Retrenchment needs a BIR certificate (RMO 66-2016). |
| Closure due to serious losses | None (Art. 298) | n/a |
| Disease | ½ month per year, at least 1 month (Art. 299) | Exempt |
| Resignation, end of contract, failed probation, just cause | None required by law. Pay it if a contract, CBA or policy says so. | Taxable |
| Retirement | RA 7641 or the company plan, whichever is higher | Exempt under RA 7641. A company plan needs age 50+ and 10+ years, once only (NIRC 32(B)(6)(a)). |
| Death | Company death benefit, if any | Exempt |

The exemption for separation "for any cause beyond the control" of the employee is in NIRC Sec. 32(B)(6)(b).

## Timing and documents

- Release final pay within **30 days** of the last day, unless company policy or a CBA says sooner (DOLE Labor Advisory 06-20).
- Give a **certificate of employment** within 3 days of a request (LA 06-20).
- Give **BIR Form 2316** on the day of separation (RR 2-98 as amended).
- Clearance can be required, but it can't be used to hold final pay beyond what's owed.

## Notice checks shown on the statement

- **Resignation:** at least 30 days between the resignation letter and the last day, or a recorded waiver (Art. 300).
- **Authorized causes:** written notice to the employee and DOLE at least one month ahead (Art. 298). Missing notice makes the dismissal procedurally defective (nominal damages, *Agabon* and *Jaka* doctrines).
- **Just cause:** reminder to document the two-notice process.
- **Failed probation:** blocked if no written standards are on file.

## Sources

- DOLE Labor Advisory 06-20, final pay and certificate of employment: [DOLE](https://www.dole.gov.ph/news/labor-advisory-no-06-series-of-2020-guidelines-on-the-payment-of-final-pay-and-issuance-of-certificate-of-employment/)
- Labor Code Arts. 297–300: [Official Gazette](https://www.officialgazette.gov.ph/1974/05/01/presidential-decree-no-442-s-1974/)
- RA 7641, Retirement Pay Law: [Lawphil](https://lawphil.net/statutes/repacts/ra1992/ra_7641_1992.html)
- Tax on retirement benefits (RA 7641 and private plans): [PwC Taxwise](https://pwc.com/ph/en/tax/tax-publications/taxwise-or-otherwise/2024/taxability-of-retirement-benefits.html)
- Tax on separation pay and the BIR exemption certificate: [Grant Thornton](https://grantthornton.com.ph/insights/articles-and-updates1/lets-talk-tax/taxation-of-separation-pay), [KPMG](https://home.kpmg/ph/en/home/insights/2017/02/making-separation-a-less-taxing-situation.html)

## Verify with a payroll accountant

- Whether to use the latest monthly rate or an average for separation pay when pay changed recently. The app uses the latest rate.
- Whether the last cutoff's loan installment should be taken from the last cutoff or from the remaining balance. The app takes it from the last cutoff and counts the rest as the balance.
