-- Employee management: first slice of the HRIS schema.
-- The prototype's mock data (lib/mock-data.ts) mirrors these tables row for row,
-- so swapping the in-memory store for Supabase queries is a data-layer change only.

create extension if not exists "pgcrypto";

create type employment_status as enum ('active', 'onboarding', 'on_leave', 'offboarded');
create type employment_type   as enum ('full_time', 'part_time', 'contractor', 'intern');
create type onboarding_phase  as enum ('before_start', 'first_day', 'first_week', 'first_90_days');
create type task_owner_role   as enum ('people_team', 'it', 'manager', 'new_hire', 'buddy');
create type onboarding_status as enum ('in_progress', 'completed', 'cancelled');

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table departments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  head_id          uuid, -- fk added after employees exists
  created_at       timestamptz not null default now(),
  unique (organization_id, name)
);

create table locations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  city             text,
  country_code     char(2),
  timezone         text not null default 'UTC',
  is_remote        boolean not null default false
);

create table employees (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete set null,
  employee_number  text not null,
  first_name       text not null,
  last_name        text not null,
  preferred_name   text,
  pronouns         text,
  work_email       text not null,
  phone            text,
  job_title        text not null,
  department_id    uuid references departments(id) on delete set null,
  location_id      uuid references locations(id) on delete set null,
  manager_id       uuid references employees(id) on delete set null,
  employment_type  employment_type not null default 'full_time',
  status           employment_status not null default 'onboarding',
  start_date       date not null,
  end_date         date,
  birthday         date,
  avatar_url       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, employee_number),
  unique (organization_id, work_email),
  check (manager_id is null or manager_id <> id)
);

alter table departments
  add constraint departments_head_fk foreign key (head_id) references employees(id) on delete set null;

create index employees_manager_idx    on employees (manager_id);
create index employees_department_idx on employees (department_id);
create index employees_status_idx     on employees (organization_id, status);

-- Job changes, promotions, transfers. Drives the profile's employment history.
create table employment_events (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  effective_date  date not null,
  kind            text not null check (kind in ('hired', 'promotion', 'transfer', 'title_change', 'manager_change', 'leave', 'return')),
  job_title       text,
  department_id   uuid references departments(id),
  note            text,
  created_at      timestamptz not null default now()
);

create table employee_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  name          text not null,
  category      text not null check (category in ('contract', 'identity', 'tax', 'policy', 'other')),
  storage_path  text not null, -- Supabase Storage object key
  size_bytes    integer not null,
  uploaded_at   timestamptz not null default now()
);

create table onboarding_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null
);

create table onboarding_template_tasks (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references onboarding_templates(id) on delete cascade,
  title            text not null,
  phase            onboarding_phase not null,
  owner_role       task_owner_role not null,
  due_offset_days  integer not null, -- relative to the new hire's start date
  position         integer not null
);

create table onboarding_cases (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null unique references employees(id) on delete cascade,
  template_id   uuid references onboarding_templates(id) on delete set null,
  buddy_id      uuid references employees(id) on delete set null,
  status        onboarding_status not null default 'in_progress',
  created_at    timestamptz not null default now()
);

create table onboarding_tasks (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references onboarding_cases(id) on delete cascade,
  title         text not null,
  phase         onboarding_phase not null,
  owner_role    task_owner_role not null,
  assignee_id   uuid references employees(id) on delete set null,
  due_date      date not null,
  completed_at  timestamptz,
  position      integer not null
);

create index onboarding_tasks_case_idx on onboarding_tasks (case_id, position);

-- Row level security: every table is scoped to the caller's organization.
-- Policies land with auth; enabled now so nothing ships open by accident.
alter table organizations              enable row level security;
alter table departments                enable row level security;
alter table locations                  enable row level security;
alter table employees                  enable row level security;
alter table employment_events          enable row level security;
alter table employee_documents         enable row level security;
alter table onboarding_templates       enable row level security;
alter table onboarding_template_tasks  enable row level security;
alter table onboarding_cases           enable row level security;
alter table onboarding_tasks           enable row level security;
