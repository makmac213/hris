-- Time in and time out rules (docs/time-punches.md). The app checks first with a clear message (lib/punch.ts);
-- this is the backstop, and the part that stops two devices racing for the same person.

alter type notification_kind add value if not exists 'missing_time_out';

-- One punch per person, kind and instant: a retried upload of the same offline punch can't land twice.
create unique index if not exists time_records_same_punch_idx
  on time_records (employee_id, kind, recorded_at) where source = 'device';

-- Insert a device punch under a per-person lock, so concurrent devices see each other's punches.
-- Returns the existing row when it is the same punch (same kind within 2 minutes).
create or replace function record_punch(
  p_org uuid, p_employee uuid, p_kind time_record_kind, p_at timestamptz, p_work_date date, p_shift uuid,
  p_photo text, p_lat double precision, p_lng double precision, p_acc real, p_device text
) returns time_records language plpgsql as $$
declare
  dup  time_records;
  prev time_records;
  nxt  time_records;
  n    int;
  rec  time_records;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text, 0));

  select * into dup from time_records
   where employee_id = p_employee and source = 'device' and kind = p_kind
     and recorded_at between p_at - interval '2 minutes' and p_at + interval '2 minutes'
   order by recorded_at limit 1;
  if found then return dup; end if;

  select count(*) into n from time_records where employee_id = p_employee and work_date = p_work_date and source = 'device';
  if n >= 12 then raise exception 'too_many_punches' using errcode = 'P0001'; end if;

  select * into prev from time_records
   where employee_id = p_employee and work_date = p_work_date and source = 'device' and recorded_at <= p_at
   order by recorded_at desc limit 1;
  select * into nxt from time_records
   where employee_id = p_employee and work_date = p_work_date and source = 'device' and recorded_at > p_at
   order by recorded_at limit 1;

  if prev.id is null and p_kind = 'clock_out'
     and not exists (select 1 from time_records where employee_id = p_employee and work_date = p_work_date and source = 'correction' and kind = 'clock_out') then
    raise exception 'time_in_first' using errcode = 'P0001';
  end if;
  if prev.kind = p_kind or nxt.kind = p_kind then raise exception 'must_alternate' using errcode = 'P0001'; end if;
  if (prev.id is not null and p_at - prev.recorded_at < interval '60 seconds')
     or (nxt.id is not null and nxt.recorded_at - p_at < interval '60 seconds') then
    raise exception 'too_soon' using errcode = 'P0001';
  end if;

  insert into time_records (organization_id, employee_id, shift_code_id, kind, recorded_at, work_date, source, photo_path, latitude, longitude, accuracy_m, device)
  values (p_org, p_employee, p_shift, p_kind, p_at, p_work_date, 'device', p_photo, p_lat, p_lng, p_acc, p_device)
  returning * into rec;
  return rec;
end $$;
