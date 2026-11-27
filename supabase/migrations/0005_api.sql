-- REST API: API keys, idempotent retries, and the one write that must be atomic.
-- See docs/api.md.

-- API keys for servers and devices. Only the SHA-256 hash is stored; the key is shown once.
create table api_keys (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  prefix           text not null,                 -- first 12 characters, for display
  hash             text not null unique,          -- hex SHA-256 of the full key
  scopes           text[] not null check (scopes <@ array[
                     'employees:read', 'employees:write', 'time:write', 'requests:read', 'requests:write',
                     'payroll:read', 'payroll:write', 'leave:read']::text[]),
  created_by       uuid references employees(id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  last_used_at     timestamptz
);
create index api_keys_org_idx on api_keys (organization_id);

-- Responses to POSTs sent with an Idempotency-Key, kept 24 hours so retries don't repeat the work.
create table api_idempotency (
  scope       text not null,      -- caller, method and path
  key         text not null,
  status      int not null,
  body        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (scope, key)
);
create index api_idempotency_age_idx on api_idempotency (created_at);
-- Purge daily, e.g. with pg_cron: delete from api_idempotency where created_at < now() - interval '24 hours';

alter table api_keys enable row level security;
alter table api_idempotency enable row level security;
-- Only the service role reads api_keys and api_idempotency. No policies means no access for user sessions.

-- Deciding a time correction updates the request and adds the correction record together, or not at all.
create or replace function decide_correction(p_request uuid, p_decider uuid, p_approve boolean, p_note text)
returns time_correction_requests
language plpgsql security invoker as $$
declare
  r time_correction_requests;
  emp employees;
begin
  update time_correction_requests
     set status = case when p_approve then 'approved'::request_status else 'rejected'::request_status end,
         decided_by = p_decider, decided_at = now(), decision_note = p_note
   where id = p_request and status = 'pending'
  returning * into r;
  if not found then raise exception 'request % is not pending', p_request using errcode = 'P0001'; end if;
  if p_approve then
    select * into emp from employees where id = r.employee_id;
    insert into time_records (organization_id, employee_id, shift_code_id, kind, recorded_at, work_date, source, correction_request_id)
    values (emp.organization_id, r.employee_id, emp.shift_code_id,
            case when r.kind in ('missing_in', 'wrong_in') then 'clock_in'::time_record_kind else 'clock_out'::time_record_kind end,
            r.proposed_at, r.work_date, 'correction', r.id);
  end if;
  return r;
end $$;
