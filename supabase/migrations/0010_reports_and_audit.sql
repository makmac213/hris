-- Reports and the audit trail (docs/reports.md).
-- Reports read existing tables, so the only new data is the audit log. In the prototype the store and the API
-- write it by diffing before and after (lib/audit.ts). Here a trigger writes it, so nothing can change a row
-- without leaving a trace, whichever client made the change.

alter type app_role add value if not exists 'executive';

create type audit_action as enum ('create', 'update', 'delete');

create table audit_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  at               timestamptz not null default now(),
  actor_id         uuid references employees (id) on delete set null,
  actor_label      text not null,                  -- the person's name, "API key hk_ab12", or "System"
  action           audit_action not null,
  entity           text not null,                  -- the table name
  entity_id        uuid not null,
  summary          text not null,
  changes          jsonb not null default '[]'     -- [{ field, from, to }]
);
create index audit_log_org_at_idx on audit_log (organization_id, at desc);
create index audit_log_entity_idx on audit_log (entity, entity_id, at desc);

-- Append only: nobody updates or deletes history, not even the service role through the API.
create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_append_only();

-- A value as the log shows it: inline photos hidden, long values cut at 120 characters (as lib/audit.ts does).
create or replace function audit_value(field text, v jsonb) returns jsonb language sql immutable as $$
  select case
    when v is null then null
    when v #>> '{}' like 'data:%' then to_jsonb('(photo)'::text)
    when length(coalesce(v #>> '{}', v::text)) > 120 then to_jsonb(left(coalesce(v #>> '{}', v::text), 117) || '...')
    else v
  end
$$;

-- The API sets these per request: set_config('app.actor_id', ..., true) and set_config('app.actor_label', ..., true).
-- A signed-in person falls back to auth.uid().
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_j   jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_j   jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  row_j   jsonb := coalesce(new_j, old_j);
  diff    jsonb := '[]';
  k       text;
  actor   uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  label   text := nullif(current_setting('app.actor_label', true), '');
  org     uuid := (coalesce(new_j, old_j) ->> 'organization_id')::uuid;
begin
  -- Child tables carry employee_id, not organization_id.
  if org is null and row_j ? 'employee_id' then
    select e.organization_id into org from employees e where e.id = (row_j ->> 'employee_id')::uuid;
  end if;
  if org is null then return coalesce(new, old); end if;

  if actor is null then
    select e.id into actor from employees e where e.user_id = auth.uid();
  end if;
  if label is null then
    select coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name into label from employees e where e.id = actor;
  end if;

  for k in select jsonb_object_keys(coalesce(new_j, '{}') || coalesce(old_j, '{}')) loop
    continue when k in ('updated_at', 'created_at', 'organization_id', 'id', 'data');
    if tg_op = 'UPDATE' and (old_j -> k) is not distinct from (new_j -> k) then continue; end if;
    diff := diff || jsonb_build_array(jsonb_build_object(
      'field', k,
      'from', audit_value(k, old_j -> k),
      'to',   audit_value(k, new_j -> k)));
  end loop;
  if tg_op = 'UPDATE' and jsonb_array_length(diff) = 0 then return new; end if;

  insert into audit_log (organization_id, actor_id, actor_label, action, entity, entity_id, summary, changes)
  values (
    org, actor, coalesce(label, 'System'),
    case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end::audit_action,
    -- Settings tables have no id of their own: the row is the person's, or the organization's.
    tg_table_name, coalesce(row_j ->> 'id', row_j ->> 'employee_id', org::text)::uuid,
    initcap(replace(tg_table_name, '_', ' ')) || ' ' || lower(case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end),
    case when tg_op = 'UPDATE' then diff else '[]' end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'employees', 'employment_events', 'compensation', 'employee_documents', 'departments', 'locations', 'clients',
    'leave_types', 'leave_requests', 'leave_adjustments', 'overtime_requests', 'time_correction_requests',
    'time_records', 'shift_codes', 'shift_assignments', 'schedule_settings', 'holidays',
    'payroll_periods', 'payroll_items', 'payroll_settings', 'employee_payroll_settings', 'pay_item_types', 'pay_items',
    'payslips', 'approval_settings', 'api_keys', 'onboarding_cases'
  ] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- API keys can now read reports.
alter table api_keys drop constraint if exists api_keys_scopes_check;
alter table api_keys add constraint api_keys_scopes_check check (scopes <@ array[
  'employees:read', 'employees:write', 'time:write', 'requests:read', 'requests:write',
  'payroll:read', 'payroll:write', 'leave:read', 'schedule:read', 'schedule:write', 'reports:read']::text[]);

alter table audit_log enable row level security;
-- Policies come with the rest of RLS when the Supabase project is connected (docs/api.md, "Rollout"):
-- audit_log: read for admin only; no insert, update or delete policy (only the trigger writes, as security definer).
