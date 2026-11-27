-- Issued payslips (docs/payslips.md). Finalizing a period saves each person's payslip as computed then,
-- so it never changes afterwards. Payroll records are kept at least three years
-- (Omnibus Rules Implementing the Labor Code, Book III, Rule X): nothing here deletes them.

create table payslips (
  id               text primary key,                -- '<period_id>:<employee_id>'
  organization_id  uuid not null references organizations(id) on delete cascade,
  period_id        uuid not null references payroll_periods(id) on delete restrict,
  employee_id      uuid not null references employees(id) on delete restrict,
  issued_at        timestamptz not null default now(),
  gross            numeric(12, 2) not null,
  net              numeric(12, 2) not null,
  data             jsonb not null,                  -- the full calculation: lines, contributions, tax, day by day
  unique (period_id, employee_id),
  check (id = period_id::text || ':' || employee_id::text)
);
create index payslips_employee_idx on payslips (employee_id, period_id);

-- Issued payslips are read-only. Fixing one means a payroll adjustment in a later period.
create or replace function payslips_read_only() returns trigger language plpgsql as $$
begin
  raise exception 'Issued payslips can''t be changed. Make a payroll adjustment in an open period instead.';
end $$;
create trigger payslips_no_update before update or delete on payslips
  for each row execute function payslips_read_only();

alter table payslips enable row level security;
-- Policies come with the rest of RLS: the person reads their own; admin and HR read all; nobody else, managers included.
