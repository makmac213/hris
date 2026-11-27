-- Payroll: compensation, holidays, overtime and correction requests, payroll periods.
-- Mirrors lib/types.ts, lib/payroll.ts and the payroll section of lib/mock-data.ts.
-- Rules and sources: docs/payroll-rules.md.

-- ---- Compensation ----------------------------------------------------------
create type pay_basis as enum ('monthly', 'hourly');

create table compensation (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  pay_basis        pay_basis not null,
  rate             numeric(12,2) not null check (rate > 0), -- PHP per month or per hour
  is_managerial    boolean not null default false,          -- Labor Code Art. 82: no OT, NSD or holiday premium
  on_ph_payroll    boolean not null default true,
  effective_from   date not null,
  created_at       timestamptz not null default now(),
  unique (employee_id, effective_from)
);

-- ---- Holidays --------------------------------------------------------------
-- Loaded each year from the President's proclamation (2026: Proclamation No. 1006, s. 2025).
create type holiday_kind as enum ('regular', 'special_non_working', 'special_working');

create table holidays (
  organization_id  uuid not null references organizations(id) on delete cascade,
  date             date not null,
  name             text not null,
  kind             holiday_kind not null,
  primary key (organization_id, date)
);

-- ---- Requests --------------------------------------------------------------
create type request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- Overtime is never paid automatically. Only approved requests, and only the
-- part the employee's time records actually cover, are paid (Art. 87).
create table overtime_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  work_date        date not null,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  reason           text not null check (length(trim(reason)) >= 10),
  status           request_status not null default 'pending',
  filed_at         timestamptz not null default now(),
  decided_by       uuid references employees(id),
  decided_at       timestamptz,
  decision_note    text,
  check (end_at > start_at and end_at - start_at <= interval '12 hours'),
  check (decided_by is null or decided_by <> employee_id),           -- nobody approves their own
  check (status <> 'rejected' or coalesce(length(trim(decision_note)), 0) > 0)
);
create index overtime_requests_employee_idx on overtime_requests (employee_id, work_date);
create index overtime_requests_pending_idx on overtime_requests (organization_id) where status = 'pending';

create type correction_kind as enum ('missing_in', 'missing_out', 'wrong_in', 'wrong_out');

create table time_correction_requests (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  employee_id         uuid not null references employees(id) on delete cascade,
  work_date           date not null,
  kind                correction_kind not null,
  proposed_at         timestamptz not null check (proposed_at <= now()),
  original_record_id  uuid references time_records(id),
  reason              text not null check (length(trim(reason)) >= 10),
  status              request_status not null default 'pending',
  filed_at            timestamptz not null default now(),
  decided_by          uuid references employees(id),
  decided_at          timestamptz,
  decision_note       text,
  check (decided_by is null or decided_by <> employee_id),
  check ((kind in ('wrong_in', 'wrong_out')) = (original_record_id is not null))
);
create unique index correction_one_pending on time_correction_requests (employee_id, work_date, kind) where status = 'pending';

-- ---- Time records: corrections ---------------------------------------------
-- An approved correction adds a new record next to the original; nothing is overwritten.
create type time_record_source as enum ('device', 'correction');

alter table time_records
  add column source time_record_source not null default 'device',
  add column correction_request_id uuid references time_correction_requests(id),
  alter column photo_path drop not null,
  alter column latitude   drop not null,
  alter column longitude  drop not null,
  alter column accuracy_m drop not null,
  add constraint time_records_proof check (
    (source = 'device' and photo_path is not null and latitude is not null and longitude is not null and accuracy_m is not null and correction_request_id is null)
    or (source = 'correction' and correction_request_id is not null)
  );

-- ---- Payroll periods -------------------------------------------------------
-- Semi-monthly: 1st–15th paid on the 20th; 16th–end paid on the 5th (Art. 103).
create type payroll_status as enum ('open', 'finalized', 'paid');

create table payroll_periods (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  start_date       date not null,
  end_date         date not null,
  pay_date         date not null,
  status           payroll_status not null default 'open',
  finalized_at     timestamptz,
  finalized_by     uuid references employees(id),
  unique (organization_id, start_date),
  check (end_date >= start_date and pay_date > end_date and pay_date - end_date <= 16)
);

-- One computed payslip per employee per period, frozen at finalization.
create table payroll_items (
  id                  uuid primary key default gen_random_uuid(),
  payroll_period_id   uuid not null references payroll_periods(id) on delete cascade,
  employee_id         uuid not null references employees(id),
  gross               numeric(12,2) not null,
  taxable             numeric(12,2) not null,
  withholding_tax     numeric(12,2) not null,
  employee_contrib    numeric(12,2) not null,
  employer_contrib    numeric(12,2) not null,
  net                 numeric(12,2) not null,
  minimum_wage_earner boolean not null default false,
  lines               jsonb not null,  -- earnings, deductions, contributions, with their basis text
  days                jsonb not null,  -- the day-by-day calculation used, for audit
  rules_version       text not null,   -- e.g. 'PH-2026.11': which rate tables were applied
  created_at          timestamptz not null default now(),
  unique (payroll_period_id, employee_id)
);

alter table compensation             enable row level security;
alter table holidays                 enable row level security;
alter table overtime_requests        enable row level security;
alter table time_correction_requests enable row level security;
alter table payroll_periods          enable row level security;
alter table payroll_items            enable row level security;

-- Policy sketch, finished when auth lands:
--  * requests insert: employee_id = caller; work_date not in a finalized period.
--  * requests update (decide): admin/hr, or the employee's direct manager; never the requester.
--    Approving a correction inserts a time_records row with source = 'correction' in the same transaction.
--  * compensation, payroll_items select: own rows, or admin/hr. Managers do not see pay.
--  * payroll_periods finalize: admin/hr only; blocked while requests in the period are pending.
