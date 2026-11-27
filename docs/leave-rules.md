# Leave rules

Philippine law sets the minimum leave every employer must give. Halden's own policies sit on top of it. The app enforces both. A company can give more days or better terms than the law. It can never give fewer.

Code: `lib/leave.ts`. Screens: **My leave**, **Leave policies** (admin and HR), the **Leave** tab on a profile, and leave requests in **Approvals**.

## Statutory leave (the floor)

| Leave | Days | Who | Paid by | Basis |
| --- | --- | --- | --- | --- |
| Service incentive leave (SIL) | 5 workdays a year | Everyone with at least 1 year of service. Exempt: companies that already give at least 5 paid leave days, managerial staff, field personnel, and establishments with fewer than 10 workers | Employer. Unused days are converted to cash at year end | Labor Code Art. 95; IRR Book III Rule V |
| Maternity leave | 105 calendar days. 120 for solo parents. 60 for miscarriage or emergency termination | Female employees, every pregnancy, no service minimum. Up to 7 days can be given to the father | SSS benefit, advanced by the employer and reimbursed. The employer pays any salary difference | RA 11210 and IRR |
| Paternity leave | 7 workdays | Married male employees who live with their spouse, for the first 4 deliveries or miscarriages | Employer, full pay | RA 8187. Still 7 days in 2026; bills to extend it are pending |
| Solo parent leave | 7 workdays a year | Solo parents with a Solo Parent ID and at least 6 months of service | Employer, full pay | RA 8972 as amended by RA 11861 (2022) |
| VAWC leave | 10 days a year, extendable by a protection order | Women who are victims of violence, and their children | Employer, full pay | RA 9262 Sec. 43 |
| Special leave for women | Up to 2 months | Women who had surgery for a gynecological disorder, with at least 6 months of service in the last 12 | Employer, full pay | RA 9710 (Magna Carta of Women) Sec. 18 |

Statutory leave is a yearly entitlement once the person is eligible. It is not prorated.

## Company leave (Halden's seed policies)

| Leave | Days | Earned | Rules |
| --- | --- | --- | --- |
| Vacation leave | 15 | 1.25 a month after 6 months | Up to 5 days roll over. The rest is paid in cash in the December 16–31 payroll. It replaces SIL (Art. 95 exemption). |
| Sick leave | 15 | 1.25 a month after 6 months | Medical certificate for 2 or more days in a row. Not paid in cash. |
| Bereavement leave | 3 each time | Per event | Death of a spouse, child, parent or sibling. |
| Birthday leave | 1 a year | Yearly | In the birthday month. |
| Leave without pay | Up to 30 each time | Per event | Unpaid. Deducted like an absence and left out of the 13th month base. |
| Paternity leave | 10 (law: 7) | Per event | Shows how a company can be more generous with a statutory leave. |

## How the app applies the floor

- **Editing a statutory leave** in Leave policies:
  - The number of days can't go below the legal minimum (checked in the form and in `saveLeaveType`).
  - The service requirement can't be lengthened.
  - It can't be made unpaid or turned off.
- **Replacing SIL:** a company leave marked "replaces service incentive leave" must be paid and give at least 5 days a year. When one exists, people see it instead of SIL.
- **Joiners and leavers** get a share of yearly company leave for the part of the year they are eligible, rounded to half days. Monthly leave is earned at the end of each full month.
- **Using credits:** a request can only use credits earned by its first day, plus carry-over and HR adjustments, less approved and pending requests.
- **Counting days:** most leave counts workdays, so rest days and holidays inside the range are free. Maternity leave and special leave for women count calendar days.
- **Half days:** for a single date only. A paid half day covers undertime first, then lateness.
- **Requests that cross into a new year** must be split, because balances are per year.

## How leave reaches payroll

- **Paid leave is not an absence.** Monthly-paid staff keep their full basic pay. Hourly staff are paid the scheduled hours of the leave day.
- **Leave without pay** is deducted at the daily rate, labeled with the leave type.
- **Holiday pay:** paid leave on the workday before a regular holiday counts as present for holiday pay (Art. 94 IRR). So do successive holidays.
- **Year-end cash conversion:** unused convertible days are paid in the December 16–31 payroll, at the daily rate. Days kept as carry-over aren't paid. Tax treatment:
  - Up to 12 days a year of vacation leave (and SIL) is de minimis, so tax-free (RR 29-2025).
  - Days over 12 join the ₱90,000 pool for 13th month and other benefits.
  - Cash conversion of other leave, such as sick leave, is taxable compensation.
- **On separation:** all unused convertible days are paid in final pay, and nothing is carried. See [final pay](final-pay.md).

## Sources

- Labor Code Art. 95 and DOLE Handbook on Statutory Monetary Benefits: [DOLE BWC handbook](https://bwc.dole.gov.ph/images/Downloads/2023%20Handbook%20on%20Statutory%20Monetary%20Benefits.pdf)
- RA 11210, Expanded Maternity Leave Law: [Official Gazette](https://www.officialgazette.gov.ph/2019/02/20/republic-act-no-11210/)
- RA 8187, Paternity Leave Act: [Official Gazette](https://www.officialgazette.gov.ph/1996/06/11/republic-act-no-8187/)
- RA 11861, Expanded Solo Parents Welfare Act: [Official Gazette](https://www.officialgazette.gov.ph/downloads/2022/06jun/20220604-RA-11861-RRD.pdf)
- RA 9262 Sec. 43, VAWC leave: [Official Gazette](https://www.officialgazette.gov.ph/2004/03/08/republic-act-no-9262/)
- RA 9710 Sec. 18, Magna Carta of Women: [Official Gazette](https://www.officialgazette.gov.ph/2009/08/14/republic-act-no-9710/)
- RR 29-2025, de minimis ceilings, including monetized leave: [PwC tax alert](https://www.pwc.com/ph/en/tax/tax-publications/tax-alerts/2026/tax-alert-02.html)

## Verify with a labor lawyer or payroll accountant

- Whether a company leave that replaces SIL must keep at least 5 days convertible to cash. The app converts everything above the carry-over.
- Whether leave cash conversion counts as compensation for SSS. The app leaves it out of the SSS basis.
- The 12-day monetized leave ceiling of RR 29-2025. It was 10 days under earlier regulations.
