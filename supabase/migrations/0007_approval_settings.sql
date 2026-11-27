-- Who approves leave, overtime and time corrections (docs/approvals.md).
-- The rule: the person's direct supervisor (employees.manager_id), plus anyone whose role is listed here.
-- Admin always approves and is not stored. Nobody approves their own request.

create table approval_settings (
  organization_id  uuid primary key references organizations(id) on delete cascade,
  approver_roles   app_role[] not null default array['hr']::app_role[]
    check (approver_roles <@ array['hr', 'operations']::app_role[])
);

alter table approval_settings enable row level security;
-- Policies come with the rest of RLS: anyone in the organization reads; admin and HR write.

-- Same rule in SQL, for policies and decide_* functions to share with the app (lib/approvals.ts).
create or replace function can_approve(approver uuid, employee uuid) returns boolean
language sql stable as $$
  select approver <> employee and exists (
    select 1 from employees a
      join employees e on e.id = employee and e.organization_id = a.organization_id
      left join approval_settings s on s.organization_id = a.organization_id
     where a.id = approver and a.status <> 'offboarded'
       and (a.role = 'admin'
            or a.role = any (coalesce(s.approver_roles, array['hr']::app_role[]))
            or e.manager_id = a.id)
  );
$$;
