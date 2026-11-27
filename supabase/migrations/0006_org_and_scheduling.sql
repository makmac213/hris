-- Client accounts, the operations schedule, and in-app notifications.
-- See docs/scheduling.md. Departments and branches (the locations table) already exist.

-- An operations role: schedules shifts for everyone, no access to pay or HR records.
alter type app_role add value if not exists 'operations';

-- ---- Clients (BPO accounts) --------------------------------------------------------
create table clients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  code             text not null check (code ~ '^[A-Z0-9]{2,6}$'),
  industry         text,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, code)
);

alter table employees add column client_id uuid references clients(id) on delete set null;
create index employees_client_idx on employees (client_id);

-- No two branches with the same name in an organization (departments already have this).
alter table locations add constraint locations_org_name_key unique (organization_id, name);

-- ---- Schedule ------------------------------------------------------------------------
-- One row per person per day that operations scheduled. Days without a row follow the person's
-- default shift code on weekdays and rest on weekends. shift_code_id null = rest day.
create table shift_assignments (
  id                  text primary key,               -- '<employee_id>:<work_date>', so writes are idempotent upserts
  organization_id     uuid not null references organizations(id) on delete cascade,
  employee_id         uuid not null references employees(id) on delete cascade,
  work_date           date not null,
  shift_code_id       uuid references shift_codes(id),
  covers_employee_id  uuid references employees(id) on delete set null,  -- filling in for someone on leave
  note                text,
  assigned_by         text not null,                  -- employee id, or 'api-key:<prefix>'
  assigned_at         timestamptz not null default now(),
  unique (employee_id, work_date),
  check (id = employee_id::text || ':' || work_date::text),
  check (covers_employee_id is null or (shift_code_id is not null and covers_employee_id <> employee_id))
);
create index shift_assignments_org_date_idx on shift_assignments (organization_id, work_date);
create index shift_assignments_cover_idx on shift_assignments (covers_employee_id, work_date) where covers_employee_id is not null;

-- How far ahead operations can schedule, and when leave counts as short notice. One row per organization.
create table schedule_settings (
  organization_id     uuid primary key references organizations(id) on delete cascade,
  horizon_days        int not null default 60 check (horizon_days between 7 and 180),
  short_notice_hours  int not null default 48 check (short_notice_hours between 1 and 168)
);

-- Approved leave can't be scheduled over. The app checks first with a friendly message; this is the backstop.
create or replace function shift_assignment_leave_guard() returns trigger language plpgsql as $$
declare lv record;
begin
  select r.half_day into lv
    from leave_requests r
   where r.employee_id = new.employee_id and r.status = 'approved'
     and new.work_date between r.start_date and r.end_date
   limit 1;
  if found then
    if lv.half_day and new.shift_code_id is not null
       and (select kind from shift_codes where id = new.shift_code_id) = 'half_day' then
      return new; -- a half-day shift fits around approved half-day leave
    end if;
    raise exception 'Employee % is on approved leave on %', new.employee_id, new.work_date using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger shift_assignments_leave_guard before insert or update on shift_assignments
  for each row execute function shift_assignment_leave_guard();

-- ---- Notifications -------------------------------------------------------------------
create type notification_kind as enum ('leave_approved_on_shift', 'short_notice_leave');
create table notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  recipient_id     uuid not null references employees(id) on delete cascade,
  kind             notification_kind not null,
  title            text not null,
  body             text not null,
  link             text not null,
  employee_id      uuid references employees(id) on delete cascade,   -- who it is about
  created_at       timestamptz not null default now(),
  read_at          timestamptz
);
create index notifications_recipient_idx on notifications (recipient_id, created_at desc) where read_at is null;

-- API keys can now carry the schedule scopes.
alter table api_keys drop constraint if exists api_keys_scopes_check;
alter table api_keys add constraint api_keys_scopes_check check (scopes <@ array[
  'employees:read', 'employees:write', 'time:write', 'requests:read', 'requests:write',
  'payroll:read', 'payroll:write', 'leave:read', 'schedule:read', 'schedule:write']::text[]);

alter table clients enable row level security;
alter table shift_assignments enable row level security;
alter table schedule_settings enable row level security;
alter table notifications enable row level security;
-- Policies come with the rest of RLS when the Supabase project is connected (docs/api.md, "Rollout"):
-- clients: read for the organization, write for admin and HR.
-- shift_assignments: read for operations, admin, HR, the person and their manager; write for operations, admin and HR.
-- notifications: each person reads and updates (read_at) their own; inserts come from the server.
