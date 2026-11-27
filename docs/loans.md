# Loans and deductions

SSS and Pag-IBIG salary loans, company loans and cash advances, each with a balance that payroll pays down cutoff by cutoff. Recurring deductions that aren't loans (HMO premiums, cooperative shares, union dues) stay as pay items on the person's Pay tab, as before.

## Why a loan is more than a pay item

Until now a loan was a pay item with a number of installments. That breaks in three common cases:

1. **A cutoff that can't cover it.** When pay runs short (unpaid leave, absences), the deduction is skipped or taken in part, but the installment count still moved on, so the loan "ends" with money still owed.
2. **Payments made outside payroll.** People pay SSS directly, or settle a cash advance in cash. There was nowhere to record it.
3. **Go-live.** Loans that started before Halden had no way to say how much was already repaid.

A loan now carries an amount to repay and keeps a ledger. Payroll deducts the amortization, or what's left if that's less, and stops by itself at zero. Anything that couldn't be taken stays in the balance and is collected later, so the term stretches instead of the money being lost.

## Kinds

| Kind | Set up by | Needs a signed authorization | Basis |
| --- | --- | --- | --- |
| SSS salary loan | HR, from the SSS loan billing | No, authorized by law | Social Security Act of 2018 (RA 11199): the employer deducts amortizations and remits them to SSS |
| SSS calamity loan | HR, from the SSS loan billing | No | Same |
| Pag-IBIG multi-purpose loan | HR, from the Pag-IBIG billing | No | HDMF Law of 2009 (RA 9679) |
| Pag-IBIG calamity loan | HR, from the Pag-IBIG billing | No | Same |
| Company loan | HR, or the employee asks and HR approves | Yes | Labor Code Art. 113: other deductions need the employee's written authorization |
| Cash advance | HR, or the employee asks and HR approves | Yes | Same |

The agency sets SSS and Pag-IBIG amortizations, interest included. HR types in what the agency's billing says; Halden doesn't compute agency interest. Company loans and cash advances are interest-free. If a company does charge interest, the total goes in the amount to repay and the interest is stated in the signed authorization.

A company loan or cash advance without an authorization on file is never deducted. It shows on the loan and on the payslip flags, as other unauthorized deductions do today.

## Fields

| Field | Meaning |
| --- | --- |
| Amount to repay | For agency loans, the total in the agency's amortization schedule. For company loans and advances, the amount released. |
| Repaid before Halden | Amount already paid when the loan was entered (go-live, or a loan started elsewhere). |
| Monthly amortization | What the loan takes in a month. |
| Deduct on | Split across both cutoffs (half each), the 1st–15th cutoff only, or the 16th–end cutoff only. Matches the contribution timing choice. |
| First deduction | The first payroll period ending on or after this date takes the first deduction. SSS amortizations start on the second month after the loan is granted, so HR enters that date. |
| Reference | The SSS or Pag-IBIG loan number, or the company's voucher number. |
| Authorization | Where the signed authorization is, for company loans and advances. |

## Balance and ledger

```
balance = amount to repay
        − repaid before Halden
        − deductions on issued payslips
        − payments recorded outside payroll
```

Issued payslips are the record of what payroll actually took, because they never change ([payslips.md](payslips.md)). The open period shows an estimate. To project a future period, Halden assumes every earlier period not yet issued takes its full scheduled amount.

Each deduction is the smaller of the scheduled amount and the balance, and then whatever pay can still cover after contributions and tax, in the existing priority order: SSS loans, Pag-IBIG loans, union dues, insurance, company loans, other authorized, loss or damage. A short cutoff leaves the rest in the balance.

The ledger shows, newest first: each payroll deduction with its period, payments recorded by HR, and the opening amount.

### Payments outside payroll

HR records a payment with a date, amount and note:

- **Paid directly:** the employee paid SSS, Pag-IBIG or the cashier.
- **Adjustment:** a correction, for example after reconciling with the agency's statement. Can be negative.

A payment can't take the balance below zero.

## Status

| Status | Meaning | Deducted |
| --- | --- | --- |
| Requested | An employee asked for a cash advance or company loan | No |
| Active | Being paid down | Yes |
| Paused | HR paused it, for example during maternity leave or a suspension of payments the agency granted | No |
| Paid | Balance is zero (shown, not stored) | No |
| Stopped | HR closed it with a reason, for example settled in final pay or written off | No |
| Rejected, Cancelled | A request HR turned down, or the employee withdrew | No |

## Requests from employees

Employees ask for a cash advance or a company loan from **My pay**. The request goes to admin and HR, not to the supervisor, because it's company money. Company policy, set under **Loans, Policy**:

| Setting | Default |
| --- | --- |
| Employees can ask for advances and loans | On |
| Largest cash advance | 50% of monthly basic pay |
| Largest company loan | 2 months' basic pay |
| Most deductions to repay | 12 cutoffs |
| One open request or company loan at a time | On |

The form shows the per-cutoff deduction before it's sent. HR approves with the first deduction date and the signed authorization, or rejects with a note.

Probationary employees can ask too; HR decides. Someone with a recorded last day can't ask.

## Final pay

On separation, the remaining balance of each loan is listed:

- Company loans and advances with an authorization on file are deducted from final pay.
- Without an authorization, final pay shows a check: it can't be deducted (Art. 113).
- SSS and Pag-IBIG balances are listed separately for HR to report to the agency. They aren't taken from final pay unless the employee authorizes it.

## Reports

Two payroll reports, admin and HR only:

- **Loan balances:** every open loan as of a date, with amount, repaid, balance and the expected last deduction.
- **Loan remittances:** for a month, what payroll deducted per SSS and Pag-IBIG loan, by reference number, for the agency's collection list. Company loans are listed for the books.

## API

| Method and path | What | Who |
| --- | --- | --- |
| `GET /loans` | Filters: `employee_id`, `status`, `kind` | Self; admin and HR see everyone |
| `POST /loans` | Enter a loan | Admin, HR |
| `GET /loans/{id}` | One loan with its balance and ledger | Self, admin, HR |
| `PATCH /loans/{id}` | Change the amortization, schedule, reference, authorization; pause, resume or stop | Admin, HR |
| `POST /loans/{id}/payments` | Record a payment outside payroll | Admin, HR |
| `POST /loan-requests` | Ask for a cash advance or company loan | The person |
| `POST /loans/{id}/decision` | Approve or reject a request | Admin, HR (a person), never their own |
| `POST /loans/{id}/cancel` | Withdraw a request still waiting | The person |
| `GET`, `PATCH /loan-settings` | Company policy for requests | Read: anyone. Write: admin, HR |

API keys need `payroll:read` or `payroll:write`. Managers don't see their team's loans, the same as pay.

## Data

Migration `0011_loans.sql`:

- `loans`: one row per loan, with kind, amounts, schedule, status and the request and decision fields.
- `loan_payments`: payments recorded outside payroll.
- `loan_settings`: one row per organization.

Payroll deductions aren't stored twice. They're read from the issued payslips, where each loan's line has the key `ded-<loan id>`.

## Not yet

- Importing the SSS and Pag-IBIG loan billing files directly.
- Agency loan interest and penalty computation.
- Restructuring a loan into a new schedule.
- Telling HR by notification when a request comes in. Today they see the count on Loans in the sidebar.
