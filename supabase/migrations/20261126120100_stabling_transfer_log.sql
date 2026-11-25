-- ---------------------------------------------------------------- Protokoll mit Überführungen
-- Gilt für alle Bahnhöfe: Begann die nächste Fahrt an einem anderen Bahnhof, gilt das Fahrzeug als dorthin überführt.
drop table public.stabling_transfer_sites;
-- Zusätzlich je Überführung eine Zeile am Überführungsbahnhof: Ankunft dort unbekannt (frühestens die Ankunft vorher), Abfahrt beobachtet.
create or replace function public.get_stabling_log(p_from timestamptz, p_to timestamptz, p_weekdays_only boolean default true) returns jsonb
language sql stable set search_path = '' as $$
  with e as (
    select x.*, exists (select 1 from public.parking_estimates p where p.vehicle_id = x.vehicle_id and p.status = 'parked_assumed'
        and p.line_id = x.line_id and p.train_number = x.train_number and abs(extract(epoch from p.arrived_at - x.arrived_at)) < 21600) as confirmed
    from public.stabling_events x
    where x.discarded_at is null and x.arrived_at >= p_from and x.arrived_at < p_to
      and (not p_weekdays_only or extract(isodow from x.arrived_at at time zone 'Europe/Berlin') < 6)
  ), g as (
    select station_id, min(station_name) as station_name, service_date, line_id, train_number, min(origin_name) as origin_name, min(arrived_at) as arrived_at,
      min(arr_platform) as arr_platform, array_agg(vehicle_id order by vehicle_id) as vehicles, sum(cars) as cars,
      departed_at, min(dep_platform) as dep_platform, dep_line_id, dep_train_number, min(dep_destination) as dep_destination, seen_again_at, seen_again_station,
      seen_again_station_id, min(next_line_id) as next_line_id, min(next_train_number) as next_train_number, min(next_destination) as next_destination,
      min(next_platform) as next_platform, min(confidence) as confidence, bool_and(confirmed) as confirmed
    from e where moved_at is null
    group by station_id, service_date, line_id, train_number, departed_at, dep_line_id, dep_train_number, seen_again_at, seen_again_station, seen_again_station_id
  ), t as (
    select g.*, g.departed_at is null and g.seen_again_station_id is not null and g.seen_again_station_id <> g.station_id as relocated
    from g
  ), rows as (
    select station_name, arrived_at, train_number, to_jsonb(t) - 'confirmed' - 'relocated' || jsonb_build_object(
        'state', case when departed_at is not null then 'departed' when seen_again_at is not null then 'seen_again' when confirmed then 'open' else 'unconfirmed' end,
        'transfer_to', case when relocated then seen_again_station end, 'transfer_from', null) as j
    from t
    union all
    select seen_again_station, arrived_at, train_number, jsonb_build_object(
        'station_id', seen_again_station_id, 'station_name', seen_again_station, 'service_date', service_date, 'line_id', line_id, 'train_number', train_number,
        'origin_name', origin_name, 'arrived_at', arrived_at, 'arr_platform', null, 'vehicles', vehicles, 'cars', cars,
        'departed_at', seen_again_at, 'dep_platform', next_platform, 'dep_line_id', next_line_id, 'dep_train_number', next_train_number,
        'dep_destination', next_destination, 'seen_again_at', null, 'seen_again_station', null, 'seen_again_station_id', null,
        'next_line_id', next_line_id, 'next_train_number', next_train_number, 'next_destination', next_destination, 'next_platform', next_platform,
        'confidence', confidence, 'state', 'departed', 'transfer_to', null, 'transfer_from', station_name)
    from t where relocated
  )
  select jsonb_build_object(
    'moved', (select count(*) from e where moved_at is not null),
    'entries', coalesce((select jsonb_agg(j order by station_name, arrived_at, train_number) from rows), '[]'::jsonb));
$$;
revoke all on function public.get_stabling_log(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.get_stabling_log(timestamptz, timestamptz, boolean) to authenticated, service_role;
