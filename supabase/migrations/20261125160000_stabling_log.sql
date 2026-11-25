-- Abstellprotokoll (tatsächliche Abstellungen) und automatische Regeln: 48 h an einer Endstation oder 60 min an der
-- Schwabstraße → intern nach Plochingen. Die Verschiebung ist eine Annahme, keine Fahrt: Fahrten und Sichtungen bleiben unverändert.

-- ---------------------------------------------------------------- Regeln
create table public.stabling_rules (
  station_id text primary key,           -- '*' = alle übrigen Endstationen
  min_stay interval not null,            -- kürzere Standzeit gilt als Wende
  move_after interval,                   -- danach automatisch nach Plochingen
  is_loop boolean not null default false    -- Wendeschleife: Abfahrt auf dem Gegengleis
);
alter table public.stabling_rules enable row level security;
revoke all on public.stabling_rules from anon, authenticated;
insert into public.stabling_rules values
  ('*', '45 minutes', '48 hours', false),
  ('de:08111:6052', '15 minutes', '60 minutes', true),   -- Schwabstraße
  ('de:08116:7802', '45 minutes', null, false);          -- Plochingen

-- ---------------------------------------------------------------- Protokoll
create table public.stabling_events (
  id bigint generated always as identity primary key,
  vehicle_id text not null references public.vehicles(id) on delete cascade,
  -- Ankunftsfahrt; ohne EFA-ID, weil EFA nach Fahrplanwechseln neue IDs vergibt
  service_date date not null,
  line_id text not null,
  train_number text not null,
  origin_name text,
  station_id text not null,
  station_name text not null,
  arr_platform text,
  arrived_at timestamptz not null,
  cars int not null,
  -- Ende: Abfahrt am selben Bahnhof, sonst nur „wieder gesehen“
  departed_at timestamptz,
  dep_platform text,
  dep_line_id text,
  dep_train_number text,
  dep_destination text,
  seen_again_at timestamptz,
  seen_again_station text,
  confidence numeric not null,
  moved_at timestamptz,        -- automatische Regel hat gegriffen: nicht im Protokoll
  discarded_at timestamptz,    -- spätere Daten haben die Abstellung widerlegt
  first_detected_at timestamptz not null,
  updated_at timestamptz not null,
  unique (vehicle_id, service_date, line_id, train_number)
);
create index stabling_events_arrived_idx on public.stabling_events (arrived_at);
alter table public.stabling_events enable row level security;
revoke all on public.stabling_events from anon, authenticated;
create policy stabling_events_read on public.stabling_events for select to authenticated using ((select public.is_member()));
grant select on public.stabling_events to authenticated;

insert into private.app_config (key, value) values ('stabling_log_from', '2026-11-25 14:35+01');

-- ---------------------------------------------------------------- Schätzung um „verschoben“ erweitern
alter table public.parking_estimates drop constraint parking_estimates_status_check;
alter table public.parking_estimates add constraint parking_estimates_status_check
  check (status in ('in_service','turning','parked_assumed','absent','moved_depot','last_known','maintenance_possible','unknown'));
alter table public.vehicles drop constraint vehicles_status_check;
alter table public.vehicles add constraint vehicles_status_check
  check (status in ('in_service','turning','parked_assumed','absent','moved_depot','last_known','maintenance_possible','unknown'));
alter table public.parking_estimates
  add column moved_at timestamptz,
  add column moved_from_id text,
  add column moved_from_name text;

-- Sicherheit, dass ein Fahrzeug noch da ist: Anteil der gelesenen Abfahrten kurz nach der Ankunft und danach
create or replace function private.stabling_conf(rt bigint, rr bigint, lt bigint, lr bigint, fresh boolean) returns numeric
language sql immutable set search_path = '' as $$
  select round(0.9 * (case when rt = 0 then 0.85 else rr::numeric / rt end)
    * (0.35 + 0.65 * (case when lt = 0 then 1 else lr::numeric / lt end)) * (case when fresh then 1 else 0.5 end), 2);
$$;

drop function private.update_parking_estimates();
create function private.update_parking_estimates(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; v_cov numeric; v_cov_n int; v_fresh boolean; v_from timestamptz;
  c_depot constant text := 'de:08116:7802';
begin
  -- Alle Fahrten der letzten 4 Tage, je Zugnummer und Betriebstag eine (EFA-Doppel zusammengefasst)
  create temp table pg_temp._st on commit drop as
  with tr as (
    select distinct on (t.service_date, t.line_id, t.train_number) t.*
    from public.trips t where t.first_dep > p_now - interval '4 days' and t.first_dep < p_now + interval '3 hours' and t.train_number is not null
    order by t.service_date, t.line_id, t.train_number, (t.source = 'efa_nvbw') desc, t.updated_at desc
  ), fm as (
    select distinct on (t.service_date, t.line_id, t.train_number) t.service_date, t.line_id, t.train_number, f.vehicles, f.groups
    from public.formations f join public.trips t on t.id = f.trip_id
    where t.first_dep > p_now - interval '4 days' and t.first_dep < p_now + interval '3 hours' and cardinality(f.vehicles) > 0 and f.observed_at <= p_now
    order by t.service_date, t.line_id, t.train_number, f.observed_at desc
  )
  select tr.id, tr.service_date, tr.line_id, tr.train_number, tr.origin_name, tr.destination_name, tr.first_dep, tr.last_arr, fm.vehicles, fm.groups,
    o.station_id as from_id, o.station_name as from_name, o.platform as dep_platform, coalesce(o.dep_at, tr.first_dep) as dep_at,
    e.station_id as to_id, e.platform as arr_platform, coalesce(e.arr_planned, tr.last_arr) as planned_arr
  from tr
  left join fm on fm.service_date = tr.service_date and fm.line_id is not distinct from tr.line_id and fm.train_number = tr.train_number
  left join lateral (select s.station_id, s.station_name, coalesce(s.platform, s.planned_platform) as platform, coalesce(s.dep_est, s.dep_planned) as dep_at
    from public.trip_stops s where s.trip_id = tr.id and not coalesce(s.cancelled, false) order by s.seq limit 1) o on true
  left join lateral (select s.station_id, s.arr_planned, coalesce(s.platform, s.planned_platform) as platform from public.trip_stops s
    where s.trip_id = tr.id and not coalesce(s.cancelled, false) and (tr.stop_count is null or s.seq < tr.stop_count) order by s.seq desc limit 1) e on true
  where not tr.cancelled;
  create index on pg_temp._st (from_id, first_dep);
  analyze pg_temp._st;

  select avg((vehicles is not null)::int), count(*) into v_cov, v_cov_n
  from pg_temp._st where first_dep <= p_now - interval '5 minutes' and last_arr >= p_now - interval '45 minutes';
  v_fresh := exists (select 1 from public.collector_runs where source = 'efa_nvbw' and ok and finished_at > p_now - interval '15 minutes');

  -- ------------------------------------------------------------ Aufenthalte: Ankunft und nächste Fahrt je Fahrzeug
  create temp table pg_temp._stay on commit drop as
  with seq as (
    select u.v as vehicle_id, s.*, lead(s.id) over w as next_id,
      (select jsonb_array_length(g->'cars') from jsonb_array_elements(case when jsonb_typeof(s.groups) = 'array' then s.groups else '[]'::jsonb end) g
        where g->>'unit' = u.v and jsonb_typeof(g->'cars') = 'array' limit 1) as car_count
    from pg_temp._st s, unnest(s.vehicles) u(v)
    window w as (partition by u.v order by s.first_dep)
  )
  select q.*, r.min_stay, r.move_after, r.is_loop,
    b.first_dep as b_dep_planned, b.dep_at as b_dep, b.from_id as b_from, b.from_name as b_from_name, b.dep_platform as b_platform,
    b.line_id as b_line, b.train_number as b_train, b.destination_name as b_dest,
    least(p_now, coalesce(greatest(b.dep_at, b.first_dep), p_now)) as end_at,
    b.id is not null and greatest(b.dep_at, b.first_dep) <= p_now as ended
  from seq q
  left join pg_temp._st b on b.id = q.next_id
  join lateral (select * from public.stabling_rules x where x.station_id in (q.to_id, '*') order by (x.station_id = '*') limit 1) r on true
  where q.last_arr is not null and q.to_id is not null and (b.id is not null or q.first_dep <= p_now);
  create index on pg_temp._stay (vehicle_id);

  -- Abfahrten, mit denen das Fahrzeug hätte weiterfahren können: alle am Ankunftsbahnhof beginnenden Fahrten,
  -- in der Wendeschleife nur die auf dem Gegengleis
  create temp table pg_temp._ev on commit drop as
  select s.*, d.rt, d.rr, d.lt, d.lr, d.tt, d.tr, private.stabling_conf(d.rt, d.rr, d.lt, d.lr, v_fresh or s.ended) as conf
  from pg_temp._stay s
  left join lateral (
    select count(*) filter (where x.first_dep <= s.last_arr + s.min_stay) as rt,
      count(*) filter (where x.first_dep <= s.last_arr + s.min_stay and x.vehicles is not null) as rr,
      count(*) filter (where x.first_dep > s.last_arr + s.min_stay) as lt,
      count(*) filter (where x.first_dep > s.last_arr + s.min_stay and x.vehicles is not null) as lr,
      count(*) filter (where x.first_dep <= s.last_arr + interval '15 minutes') as tt,
      count(*) filter (where x.first_dep <= s.last_arr + interval '15 minutes' and x.vehicles is not null) as tr
    from pg_temp._st x
    where x.from_id = s.to_id and x.id <> s.id and x.id is distinct from s.next_id
      and x.first_dep between s.planned_arr - interval '3 minutes' and s.end_at
      and (not s.is_loop or x.dep_platform is null or s.arr_platform is null or x.dep_platform <> s.arr_platform)) d on true
  where s.last_arr <= p_now and (s.next_id is null or (s.end_at - s.last_arr >= s.min_stay and s.end_at > p_now - interval '24 hours'));

  -- ------------------------------------------------------------ Protokoll
  select value::timestamptz into v_from from private.app_config where key = 'stabling_log_from';

  insert into public.stabling_events as e (vehicle_id, service_date, line_id, train_number, origin_name, station_id, station_name, arr_platform, arrived_at, cars,
    departed_at, dep_platform, dep_line_id, dep_train_number, dep_destination, seen_again_at, seen_again_station, confidence, moved_at, first_detected_at, updated_at)
  select x.vehicle_id, x.service_date, x.line_id, x.train_number, x.origin_name, x.to_id, coalesce(x.destination_name, st.name), x.arr_platform, x.last_arr, coalesce(x.car_count, 4),
    case when x.ended and x.b_from = x.to_id then x.end_at end,
    case when x.ended and x.b_from = x.to_id then x.b_platform end,
    case when x.ended and x.b_from = x.to_id then x.b_line end,
    case when x.ended and x.b_from = x.to_id then x.b_train end,
    case when x.ended and x.b_from = x.to_id then x.b_dest end,
    case when x.ended then x.end_at end,
    case when x.ended then x.b_from_name end,
    x.conf,
    case when x.end_at - x.last_arr > x.move_after and (x.ended or x.conf >= 0.5 or (v_cov_n >= 10 and v_cov >= 0.85)) then x.last_arr + x.move_after end,
    p_now, p_now
  from pg_temp._ev x left join public.stations st on st.id = x.to_id
  where x.last_arr >= v_from and x.line_id is not null and x.end_at - x.last_arr >= x.min_stay
    and (exists (select 1 from public.stabling_events o where o.vehicle_id = x.vehicle_id and o.service_date = x.service_date
                   and o.line_id = x.line_id and o.train_number = x.train_number and o.discarded_at is null)
         -- Abfahrt nicht beobachtet (Fahrzeug tauchte woanders auf): nur mit hoher Sicherheit neu aufnehmen
         or (x.conf >= case when x.ended and x.b_from is distinct from x.to_id then 0.75 else 0.5 end and (not x.is_loop or x.tr = x.tt)))
  on conflict (vehicle_id, service_date, line_id, train_number) do update set
    station_id = excluded.station_id, station_name = excluded.station_name, arr_platform = excluded.arr_platform, arrived_at = excluded.arrived_at, cars = excluded.cars,
    departed_at = excluded.departed_at, dep_platform = excluded.dep_platform, dep_line_id = excluded.dep_line_id, dep_train_number = excluded.dep_train_number,
    dep_destination = excluded.dep_destination, seen_again_at = excluded.seen_again_at, seen_again_station = excluded.seen_again_station,
    -- Datenlücken senken die Sicherheit einer laufenden Abstellung nicht
    confidence = case when excluded.seen_again_at is null then greatest(e.confidence, excluded.confidence) else excluded.confidence end,
    moved_at = coalesce(excluded.moved_at, case when excluded.seen_again_at is null then e.moved_at end), discarded_at = null, updated_at = excluded.updated_at;

  -- Widerlegt: Das Fahrzeug fuhr doch gleich weiter, oder die Wagenreihung der Ankunftsfahrt wurde berichtigt
  update public.stabling_events e set discarded_at = p_now, updated_at = p_now
  where e.discarded_at is null and e.arrived_at > p_now - interval '3 days' and (
    exists (select 1 from pg_temp._stay s where s.vehicle_id = e.vehicle_id and s.service_date = e.service_date and s.line_id = e.line_id
              and s.train_number = e.train_number and s.next_id is not null and s.end_at - s.last_arr < s.min_stay and s.ended)
    or exists (select 1 from pg_temp._st t where t.service_date = e.service_date and t.line_id = e.line_id and t.train_number = e.train_number
              and t.vehicles is not null and not (e.vehicle_id = any (t.vehicles))));

  -- Ankunft älter als 4 Tage: Ende aus der ersten Fahrt danach
  update public.stabling_events e set seen_again_at = t.dep_at, seen_again_station = t.from_name,
    departed_at = case when t.from_id = e.station_id then t.dep_at end, dep_platform = case when t.from_id = e.station_id then t.dep_platform end,
    dep_line_id = case when t.from_id = e.station_id then t.line_id end, dep_train_number = case when t.from_id = e.station_id then t.train_number end,
    dep_destination = case when t.from_id = e.station_id then t.destination_name end, updated_at = p_now
  from (select distinct on (u.v) u.v, s.* from pg_temp._st s, unnest(s.vehicles) u(v) where s.dep_at <= p_now order by u.v, s.first_dep) t
  where e.seen_again_at is null and e.discarded_at is null and e.arrived_at < p_now - interval '3 days' and t.v = e.vehicle_id and t.first_dep > e.arrived_at
    and not exists (select 1 from pg_temp._stay s where s.vehicle_id = e.vehicle_id and s.service_date = e.service_date and s.line_id = e.line_id and s.train_number = e.train_number);

  -- ------------------------------------------------------------ Aktueller Stand je Fahrzeug
  with last as (
    select distinct on (u.v) u.v as vehicle_id, s.* from pg_temp._st s, unnest(s.vehicles) u(v)
    where s.first_dep <= p_now + interval '15 minutes' order by u.v, s.first_dep desc
  ), ev as (
    select l.vehicle_id, l.id, l.line_id, l.train_number, l.origin_name, l.destination_name, l.to_id, l.last_arr, r.min_stay, r.move_after, r.is_loop,
      x.rt, x.rr, x.lt, x.lr, coalesce(x.conf, 0) as conf, coalesce(x.tr = x.tt, false) as turn_read,
      p.status = 'moved_depot' and p.line_id is not distinct from l.line_id and p.train_number is not distinct from l.train_number
        and abs(extract(epoch from p.arrived_at - l.last_arr)) < 21600 as was_moved
    from last l
    left join pg_temp._ev x on x.vehicle_id = l.vehicle_id and x.id = l.id
    left join public.parking_estimates p on p.vehicle_id = l.vehicle_id
    join lateral (select * from public.stabling_rules y where y.station_id in (coalesce(l.to_id, '*'), '*') order by (y.station_id = '*') limit 1) r on true
  ), res as (
    select ev.*, case
        when last_arr > p_now then 'in_service'
        when last_arr > p_now - min_stay then 'turning'
        when was_moved or (last_arr < p_now - move_after and (conf >= 0.5 or (v_cov_n >= 10 and v_cov >= 0.85))) then 'moved_depot'
        when conf >= 0.5 and (not is_loop or turn_read) then 'parked_assumed'
        when is_loop and last_arr >= p_now - move_after then 'turning'
        when v_cov_n >= 10 and v_cov >= 0.85 then 'absent'
        else 'unknown' end as st
    from ev
  )
  insert into public.parking_estimates as p (vehicle_id, station_id, station_name, status, confidence, last_sighting_at, reason, estimated_at,
    trip_id, line_id, train_number, origin_name, arrived_at, returns_total, returns_read, later_total, later_read, moved_at, moved_from_id, moved_from_name)
  select r.vehicle_id, case r.st when 'moved_depot' then c_depot else r.to_id end, case r.st when 'moved_depot' then 'Plochingen' else r.destination_name end, r.st,
    case r.st when 'in_service' then 0.9 when 'turning' then 0.5 when 'absent' then round(0.9 * v_cov, 2) when 'moved_depot' then 0.1 else r.conf end,
    v.last_seen,
    case r.st
      when 'in_service' then 'Fahrt laut Fahrplan/Echtzeit noch nicht beendet'
      when 'turning' then case when r.is_loop then 'Wendeschleife: wendet vermutlich' else 'Vor weniger als 45 min angekommen, Rückfahrt noch möglich' end
      when 'moved_depot' then format('Automatische Regel: länger als %s an %s, nach Plochingen verschoben (Annahme, keine beobachtete Fahrt)',
        case when r.is_loop then '60 min' else '48 h' end, coalesce(r.destination_name, 'der Endstation'))
      when 'parked_assumed' then case when r.rt = 0 and r.lt = 0 then 'Nach der Ankunft fuhr dort kein Zug mehr ab'
        else format('In keiner der %s gelesenen Abfahrten danach enthalten (von %s)', r.rr + r.lr, r.rt + r.lt) end
      when 'absent' then format('In keinem der zuletzt fahrenden Züge enthalten (%s %% gelesen), Standort unsicher', round(v_cov * 100))
      else format('Zu wenige Abfahrten gelesen (%s von %s)', coalesce(r.rr + r.lr, 0), coalesce(r.rt + r.lt, 0)) end,
    p_now, r.id, r.line_id, r.train_number, r.origin_name, r.last_arr, r.rt, r.rr, r.lt, r.lr,
    case r.st when 'moved_depot' then r.last_arr + r.move_after end, case r.st when 'moved_depot' then r.to_id end, case r.st when 'moved_depot' then r.destination_name end
  from res r join public.vehicles v on v.id = r.vehicle_id
  on conflict (vehicle_id) do update set station_id = excluded.station_id, station_name = excluded.station_name, status = excluded.status,
    confidence = excluded.confidence, last_sighting_at = excluded.last_sighting_at, reason = excluded.reason, estimated_at = excluded.estimated_at,
    trip_id = excluded.trip_id, line_id = excluded.line_id, train_number = excluded.train_number, origin_name = excluded.origin_name,
    arrived_at = excluded.arrived_at, returns_total = excluded.returns_total, returns_read = excluded.returns_read,
    later_total = excluded.later_total, later_read = excluded.later_read,
    moved_at = excluded.moved_at, moved_from_id = excluded.moved_from_id, moved_from_name = excluded.moved_from_name;
  get diagnostics n = row_count;

  -- Verschobene bleiben in Plochingen, bis sie wieder fahren
  update public.parking_estimates set status = 'unknown', confidence = 0.1, reason = 'Seit mehr als 4 Tagen nicht gesehen', estimated_at = p_now
    where estimated_at < p_now and status not in ('unknown', 'moved_depot');
  update public.vehicles v set status = p.status from public.parking_estimates p where p.vehicle_id = v.id and v.status <> p.status;
  drop table pg_temp._ev, pg_temp._stay, pg_temp._st;
  return n;
end $$;
revoke all on function private.update_parking_estimates(timestamptz) from public;
revoke all on function private.stabling_conf(bigint, bigint, bigint, bigint, boolean) from public;

-- ---------------------------------------------------------------- Abfragen
create or replace function public.get_parked_vehicles() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle_id', p.vehicle_id, 'status', p.status, 'confidence', p.confidence, 'reason', p.reason,
    'station_id', p.station_id, 'station_name', p.station_name, 'arrived_at', p.arrived_at,
    'line_id', p.line_id, 'train_number', p.train_number, 'origin_name', p.origin_name, 'estimated_at', p.estimated_at,
    'moved_at', p.moved_at, 'moved_from_name', p.moved_from_name,
    'site_kind', coalesce(s.kind, 'station'), 'lat', coalesce(s.lat, st.lat), 'lon', coalesce(s.lon, st.lon)
  ) order by p.station_name, p.arrived_at desc, p.vehicle_id), '[]'::jsonb)
  from public.parking_estimates p
  left join public.stabling_sites s on s.station_id = p.station_id
  left join public.stations st on st.id = p.station_id
  where p.status in ('parked_assumed', 'absent', 'moved_depot');
$$;

-- Protokoll eines Zeitraums, je Zug eine Zeile. Fahrzeuge desselben Zuges, die getrennt abfahren, ergeben eigene Zeilen.
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
      min(confidence) as confidence, bool_and(confirmed) as confirmed
    from e where moved_at is null
    group by station_id, service_date, line_id, train_number, departed_at, dep_line_id, dep_train_number, seen_again_at, seen_again_station
  )
  select jsonb_build_object(
    'moved', (select count(*) from e where moved_at is not null),
    'entries', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('state',
      case when departed_at is not null then 'departed' when seen_again_at is not null then 'seen_again' when confirmed then 'open' else 'unconfirmed' end)
      order by g.station_name, g.arrived_at, g.train_number) from g), '[]'::jsonb));
$$;
revoke all on function public.get_stabling_log(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.get_stabling_log(timestamptz, timestamptz, boolean) to authenticated, service_role;
