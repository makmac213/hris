-- Timekeeping: roles, shift codes and time records.
-- Mirrors lib/types.ts and the timekeeping section of lib/mock-data.ts.

-- ---- Roles -----------------------------------------------------------------
-- Admin and HR assign shift codes and manage schedules. Employees record their own time.
create type app_role as enum ('admin', 'hr', 'employee');
alter table employees add column role app_role not null default 'employee';

-- ---- Shift codes -----------------------------------------------------------
create type shift_kind   as enum ('whole_day', 'half_day');
create type shift_source as enum ('system_default', 'uploaded', 'manual');

create table shift_codes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  code             text not null,            -- e.g. PH-D0800
  name             text not null,            -- e.g. Day shift, 8:00 AM
  kind             shift_kind not null,
  start_time       time not null,            -- local wall-clock time
  end_time         time not null,            -- may be earlier than start_time for overnight shifts
  break_minutes    integer not null default 0 check (break_minutes between 0 and 240),
  timezone         text not null default 'Asia/Manila',
  grace_minutes    integer not null default 5 check (grace_minutes between 0 and 120),
  source           shift_source not null default 'manual',
  is_default       boolean not null default false,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, code),
  check (start_time <> end_time)
);

-- At most one default shift per organization.
create unique index shift_codes_one_default on shift_codes (organization_id) where is_default;

alter table employees add column shift_code_id uuid references shift_codes(id) on delete set null;

-- Span in minutes, handling overnight shifts (22:00 → 07:00 = 540).
create or replace function shift_span_minutes(s shift_codes) returns integer
language sql immutable as $$
  select (extract(epoch from (s.end_time - s.start_time))::int / 60 + 1440) % 1440
$$;

-- ---- Time records ----------------------------------------------------------
-- Every record needs all three proofs: server time, a device photo and a GPS fix.
create type time_record_kind as enum ('clock_in', 'clock_out');

create table time_records (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  employee_id       uuid not null references employees(id) on delete cascade,
  shift_code_id     uuid references shift_codes(id) on delete set null, -- snapshot of the shift in force
  kind              time_record_kind not null,
  recorded_at       timestamptz not null default now(), -- set by the server, never by the client
  work_date         date not null,                      -- the shift's date (overnight shifts belong to the start day)
  photo_path        text not null,                      -- Supabase Storage key in the private time-photos bucket
  latitude          double precision not null check (latitude between -90 and 90),
  longitude         double precision not null check (longitude between -180 and 180),
  accuracy_m        real not null check (accuracy_m >= 0),
  device            text,
  created_at        timestamptz not null default now()
);

create index time_records_employee_day_idx on time_records (employee_id, work_date, recorded_at);
create index time_records_org_day_idx on time_records (organization_id, work_date);

alter table shift_codes  enable row level security;
alter table time_records enable row level security;

-- Policy sketch, finished when auth lands:
--  * time_records insert: employee_id = the caller's employee row; recorded_at defaults to now().
--  * time_records select: own rows, or any row in the org for admin/hr.
--  * shift_codes write and employees.shift_code_id update: admin/hr only.
