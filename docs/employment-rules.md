# Employment terms: probationary, regular and contractual

The Labor Code decides someone's status by the work they do and how long they have done it. A contract can't override that. The app records the status on file, works out the status the law would give, and flags the difference.

Code: `lib/employment.ts`. Screens:

- The **Employment** tab on a profile: terms, alerts, Regularize, and Record separation.
- Alerts on the **Payroll** page.

## Statuses

| Status | Rule | Basis |
| --- | --- | --- |
| Regular | Doing work usually necessary or desirable to the business. Also anyone who passes probation, or works past it. | Art. 295 [280] |
| Probationary | At most 6 months (180 days). The standards for becoming regular must be given in writing at hiring. Without them, the employee is regular from day one. | Art. 296 [281]; IRR Book VI Rule I Sec. 6; *Mitsubishi Motors v. Chrysler Phils. Labor Union* (180 days) |
| Project | Hired for a specific project whose end was made known at hiring. Ends with the project. Must be reported to DOLE. | Art. 295; DO 19-93 |
| Seasonal | Hired for a season. Ends with the season. Seasonal workers rehired each season can be regular seasonal workers. | Art. 295 |
| Casual | Work not usually necessary to the business. Becomes regular for that activity after one year of service. | Art. 295 |
| Fixed-term | Valid only when the term was knowingly and voluntarily agreed, with no intent to get around security of tenure. | *Brent School v. Zamora* (G.R. No. L-48494) |

## What the app checks

The checks run in `legalStatus` and `employmentAlerts`.

**Probationary staff**

- **No written standards on file:** the law treats them as regular. This shows as a danger alert. For someone who hasn't started yet, it's a warning to give the standards on or before day one.
- **Probation past its end date with no decision:** regular by law.
- **Probation end date set past 180 days from the start:** blocked in the form, and flagged.
- **Probation ending within 30 days:** reminder to regularize them, or to give written notice that the standards weren't met.

**Contract staff**

- **Casual with a year or more of service:** regular by law.
- **Project, seasonal or fixed-term with no end date:** danger alert.
- **Contract ending within 30 days:** reminder to decide on renewal. Repeated renewals for work necessary to the business point to regular employment.

**New hires** in a Philippine office start as probationary, with the end date set to 180 days. Standards are not marked as given until HR records the date.

## Separation reasons

The reason decides the separation pay, the notice, and the tax treatment. See [final pay](final-pay.md).

- **Resignation:** 30 days' written notice from the employee, unless waived (Art. 300 [285]).
- **Just causes:** misconduct, disobedience, neglect, fraud, crime and the like (Art. 297 [282]). Needs two written notices and a hearing.
- **Authorized causes, business:** redundancy, labor-saving devices, retrenchment, closure (Art. 298 [283]). Needs written notice to the employee and DOLE at least one month ahead.
- **Disease:** needs a public health authority's certificate (Art. 299 [284]).
- **End of a project, season or term:** ends with the engagement.
- **Failed probation:** written notice within a reasonable time before probation ends.
- **Retirement:** at 60 to 65, under RA 7641 or a company plan. 65 is the compulsory age.
- **Death.**

## Sources

- Labor Code Arts. 295–300 (renumbered by RA 10151): [Official Gazette](https://www.officialgazette.gov.ph/1974/05/01/presidential-decree-no-442-s-1974/)
- Probationary employment and the 180-day limit: [Respicio & Co.](https://www.respicio.ph/commentaries/probationary-employment-rules-in-the-philippines)
- *Brent School, Inc. v. Zamora*, G.R. No. L-48494, Feb 5, 1990: [Lawphil](https://lawphil.net/judjuris/juri1990/feb1990/gr_l_48494_1990.html)
- DO 19-93 on project employees in construction: [DOLE](https://bwc.dole.gov.ph/)
