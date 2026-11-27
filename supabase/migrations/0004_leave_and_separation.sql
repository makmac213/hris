-- Leave, employment terms, final pay and year-end tax.
-- Philippine law is the floor: statutory leave types carry legal_min_days and days can't go below it.

-- Employment terms (Labor Code Art. 295–300) -------------------------------------------
create type employment_status_ph as enum ('probationary', 'regular', 'project', 'seasonal', 'casual', 'fixed_term');
create type separation_reason as enum (
  'resignation', 'end_of_contract', 'failed_probation', 'just_cause', 'redundancy', 'labor_saving',
  'retrenchment', 'closure', 'closure_losses', 'disease', 'retirement', 'death'
);

alter table employees
  add column employment_status_ph employment_status_ph,
  add column probation_end_date date,
  add column standards_given_on date,
  add column contract_end_date date,
  add column regularized_on date,
  add column birth_date date,
  add column separation_reason separation_reason,
  add column separation_notice_date date,
  add constraint probation_max_180 check (probation_end_date is null or probation_end_date <= start_date + 179),
  add constraint contract_needs_end check (employment_status_ph not in ('project', 'seasonal', 'fixed_term') or contract_end_date is not null);

alter table employment_events drop constraint if exists employment_events_kind_check;
alter table employment_events add constraint employment_events_kind_check
  check (kind in ('hired', 'promotion', 'transfer', 'title_change', 'manager_change', 'leave', 'return', 'regularized', 'separated'));

-- Regional minimum wage ---------------------------------------------------------------
alter table locations add column ph_region text check (ph_region in ('NCR','CAR','I','II','III','IV-A','IV-B','V','VI','VII','VIII','IX','X','XI','XII','XIII','BARMM'));
alter table payroll_settings add column use_regional_minimum_wage boolean not null default true;

create table regional_wages (
  region text primary key,
  name text not null,
  daily numeric(10,2) not null check (daily > 0),
  wage_order text not null,
  effective date not null,
  note text
);

-- Leave ---------------------------------------------------------------------------------
create type leave_accrual as enum ('annual', 'monthly', 'per_event');

create table leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  statutory boolean not null default false,
  legal_basis text,
  legal_min_days numeric(6,1) not null default 0,
  days numeric(6,1) not null,
  accrual leave_accrual not null,
  calendar_days boolean not null default false,
  min_service_months int not null default 0 check (min_service_months >= 0),
  paid boolean not null default true,
  convertible boolean not null default false,
  carry_over_max numeric(6,1) not null default 0 check (carry_over_max >= 0),
  counts_as_sil boolean not null default false,
  requires_document text,
  who text,
  description text,
  active boolean not null default true,
  check (days >= legal_min_days),                       -- the law is the floor
  check (not statutory or paid),                         -- statutory leave is paid
  check (not counts_as_sil or (paid and days >= 5))      -- Art. 95 exemption needs 5+ paid days
);

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id),
  start_date date not null,
  end_date date not null,
  half_day boolean not null default false,
  reason text not null,
  status request_status not null default 'pending',
  filed_at timestamptz not null default now(),
  decided_by uuid references employees(id),
  decided_at timestamptz,
  decision_note text,
  check (end_date >= start_date),
  check (not half_day or start_date = end_date)
);
create index on leave_requests (employee_id, start_date);

create table leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id),
  year int not null,
  days numeric(6,1) not null check (days <> 0),
  note text not null,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

-- Year-to-date imported at go-live -------------------------------------------------------
create table payroll_openings (
  employee_id uuid not null references employees(id) on delete cascade,
  year int not null,
  through_date date not null,
  taxable_compensation numeric(14,2) not null default 0,
  tax_withheld numeric(14,2) not null default 0,
  non_taxable_benefits numeric(14,2) not null default 0,
  mandatory_contributions numeric(14,2) not null default 0,
  basic_pay numeric(14,2) not null default 0,
  thirteenth_paid numeric(14,2) not null default 0,
  primary key (employee_id, year)
);

-- Row-level security ------------------------------------------------------------------
alter table leave_types enable row level security;
alter table leave_requests enable row level security;
alter table leave_adjustments enable row level security;
alter table payroll_openings enable row level security;
alter table regional_wages enable row level security;

-- Policy sketch, finished when auth lands (same approach as 0003):
--  * leave_types: everyone in the organization reads; admin/hr write. Statutory rows can't go below legal_min_days (check above).
--  * leave_requests insert: employee_id = caller, status 'pending', dates not in a finalized payroll period.
--  * leave_requests update: the requester can only cancel a pending request; the direct manager or admin/hr decide, never their own.
--  * leave_adjustments: admin/hr insert with a note; the person reads their own.
--  * payroll_openings: admin/hr only.
--  * regional_wages: read-only reference data, maintained by the platform.
