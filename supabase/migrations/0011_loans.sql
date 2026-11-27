-- Loans and advances (docs/loans.md): SSS and Pag-IBIG loans, company loans and cash advances.
-- The balance isn't stored. It is amount to repay, less repaid before Halden, less the deductions on issued
-- payslips (payslips.data, line key 'ded-<loan id>'), less loan_payments. See lib/loans.ts.

create type loan_kind as enum ('sss_salary', 'sss_calamity', 'pagibig_multi_purpose', 'pagibig_calamity', 'company_loan', 'cash_advance');
create type loan_status as enum ('requested', 'active', 'paused', 'stopped', 'rejected', 'cancelled');

create table loans (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references organizations(id) on delete cascade,
  employee_id             uuid not null references employees(id) on delete cascade,
  kind                    loan_kind not null,
  reference_no            text,
  purpose                 text,
  principal               numeric(12,2) not null check (principal > 0),
  paid_before             numeric(12,2) not null default 0 check (paid_before >= 0 and paid_before < principal),
  monthly_amortization    numeric(12,2) not null check (monthly_amortization > 0),
  schedule                text not null default 'split' check (schedule in ('split', 'first_cutoff', 'second_cutoff')),
  first_deduction_on      date not null,
  "authorization"         text, -- company loans and advances: the signed authorization (Labor Code Art. 113)
  status                  loan_status not null default 'active',
  stop_reason             text,
  requested_at            timestamptz,
  requested_installments  integer check (requested_installments between 1 and 48),
  decided_by              uuid references employees(id),
  decided_at              timestamptz,
  decision_note           text,
  created_by              uuid references employees(id),
  created_at              timestamptz not null default now(),
  check (status <> 'stopped' or stop_reason is not null),
  check (kind in ('company_loan', 'cash_advance') or reference_no is not null),
  check (decided_by is null or decided_by <> employee_id)
);
create index loans_employee_idx on loans (employee_id, status);
create index loans_org_status_idx on loans (organization_id, status);

create type loan_payment_method as enum ('paid_directly', 'adjustment');

-- Payments made outside payroll. Payroll deductions are read from the issued payslips, not copied here.
create table loan_payments (
  id            uuid primary key default gen_random_uuid(),
  loan_id       uuid not null references loans(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  paid_on       date not null,
  amount        numeric(12,2) not null check (amount <> 0),
  method        loan_payment_method not null default 'paid_directly',
  note          text,
  recorded_by   uuid references employees(id),
  recorded_at   timestamptz not null default now(),
  check (method = 'adjustment' or amount > 0)
);
create index loan_payments_loan_idx on loan_payments (loan_id, paid_on);

-- Company policy for requests from employees.
create table loan_settings (
  organization_id          uuid primary key references organizations(id) on delete cascade,
  allow_requests           boolean not null default true,
  cash_advance_max_share   numeric(4,3) not null default 0.5 check (cash_advance_max_share > 0 and cash_advance_max_share <= 1),
  company_loan_max_months  numeric(4,1) not null default 2 check (company_loan_max_months > 0),
  max_installments         integer not null default 12 check (max_installments between 1 and 48),
  one_open_at_a_time       boolean not null default true
);

alter table loans          enable row level security;
alter table loan_payments  enable row level security;
alter table loan_settings  enable row level security;
-- Policies come with the rest of RLS (docs/api.md, "Rollout"):
--   loans, loan_payments: the employee reads their own; admin and HR read and write all in the organization.
--   loans insert by an employee: only status = 'requested', kind in ('company_loan', 'cash_advance'), employee_id = self.
--   loan_settings: anyone in the organization reads; admin and HR write.

create trigger loans_audit after insert or update or delete on loans for each row execute function audit_row();
create trigger loan_payments_audit after insert or update or delete on loan_payments for each row execute function audit_row();
create trigger loan_settings_audit after insert or update or delete on loan_settings for each row execute function audit_row();
