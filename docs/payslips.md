# Payslips

Every employee on the Philippine payroll can see their own payslips under **My pay**, and in the API at `GET /payslips`.

## What an employee sees

- **Payslips:** one for each finalized period, newest first, with net pay and the pay day (or "paid" once the pay day has passed).
- **Each payslip:** earnings, time not worked, allowances and benefits, gross pay, government contributions (SSS, PhilHealth, Pag-IBIG), withholding tax, loans and other deductions, and net pay. Each line says how it was worked out. The day-by-day time used is underneath.
- **Print or save as PDF:** prints only the payslip, with the company name, the person's name, employee number and job title, and the day-by-day time expanded. The browser's print dialog saves it as a PDF.
- **This period, so far:** while a period is open, an estimate is shown separately. It isn't a payslip and can't be printed. Days that haven't happened yet count as fully worked, and pending requests aren't counted.

Only the person, admin and HR can see a payslip. A manager can't see their team's pay.

## Issued payslips don't change

When admin or HR finalizes a period, each person's payslip is saved as it was calculated at that moment (`payslips` table, migration `0008_payslips.sql`). After that, changes to time records, rates, pay items or settings don't alter it. The database refuses updates and deletes, so a correction has to be a payroll adjustment in a later, open period.

Payroll records, payment slips included, have to be kept for at least three years (Omnibus Rules Implementing the Labor Code, Book III, Rule X; see the [ILO copy of the Omnibus Rules](https://www.ilo.org/dyn/travail/docs/1216/Omnibus%20Rules%20to%20Implement%20the%20Labor%20Code.pdf) and this [summary of the retention rule](https://www.respicio.ph/commentaries/how-long-must-employers-keep-payroll-records-under-philippine-labor-law)). Nothing in the app deletes them.

## API

| Endpoint | What it does | Who |
| --- | --- | --- |
| `GET /payslips` | Issued payslips, newest first. Filters: `period_id`, `employee_id` (admin and HR). `include_estimate=true` adds the open period, marked `"estimate": true`. | Self, admin, HR |
| `GET /payslips/{id}` | One payslip with its day-by-day time. The id is `period_id:employee_id`. | Self, admin, HR |
| `POST /payroll-periods/{id}/finalize` | Finalizes the period and issues the payslips. The response has `payslips_issued`. | Admin, HR |

## Code

- `lib/payslips.ts`: `issuePayslips` (at finalize), `slipFor` (the saved copy for a closed period, or the live calculation for an open one), `payslipsOf` (a person's payslips and estimate).
- `features/payroll/MyPayView.tsx`: the page. Print styles are in `styles/globals.css` under `@media print`.
- The payroll register (`/payroll` and `GET /payroll-periods/{id}/payslips`) also reads the saved copies for finalized periods.

## Not yet

- A generated PDF file from the server, and emailing payslips on pay day.
- Payslips from before this app (imported history).
- A signed acknowledgment that the employee received the payslip.
