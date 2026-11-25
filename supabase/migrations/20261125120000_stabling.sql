-- Abstellungen (geschätzt): Ein Fahrzeug gilt als abgestellt, wenn es nach der Ankunft am Endbahnhof in keiner
-- gelesenen Rückfahrt vorkommt. An echten Daten geprüft: Rückfahrten beginnen 3–27 min nach der Ankunft am selben Bahnhof.
-- Fehlende Daten sind kein Beleg: Ungelesene Abfahrten senken die Sicherheit. Es wird nichts gelöscht.

-- Lage der Abstellgleise (OpenStreetMap, ODbL; railway=rail, service=yard/siding, elektrifiziert; Stand 25.11.2026).
-- Ob die S-Bahn genau diese Gleise nutzt, ist nicht bekannt. Ohne Eintrag wird der Bahnhof selbst angezeigt.
create table public.stabling_sites (
  station_id text primary key,
  kind text not null check (kind in ('yard','siding','turning_loop')),
  lat double precision not null,
  lon double precision not null
);
alter table public.stabling_sites enable row level security;
revoke all on public.stabling_sites from anon, authenticated;
create policy stabling_sites_read on public.stabling_sites for select to authenticated using ((select public.is_member()));
grant select on public.stabling_sites to authenticated;

insert into public.stabling_sites (station_id, kind, lat, lon) values
  ('de:08119:7600', 'yard', 48.94255, 9.42439),          -- Backnang
  ('de:08118:1400', 'yard', 48.94622, 9.13430),          -- Bietigheim
  ('de:08118:7503', 'yard', 48.94464, 9.26892),          -- Marbach (N)
  ('de:08111:6002', 'yard', 48.72497, 9.11023),          -- Vaihingen
  ('de:08115:4512', 'yard', 48.59293, 8.85937),          -- Herrenberg
  ('de:08116:7802', 'yard', 48.71263, 9.41070),          -- Plochingen
  ('de:08119:7703', 'yard', 48.80612, 9.52371),          -- Schorndorf
  ('de:08116:4211', 'yard', 48.64540, 9.43909),          -- Kirchheim (T)
  ('de:08115:7301', 'siding', 48.79815, 8.99970),        -- Leonberg
  ('de:08111:6052', 'turning_loop', 48.76729, 9.15096);  -- Schwabstraße

alter table public.parking_estimates drop constraint parking_estimates_status_check;
alter table public.parking_estimates add constraint parking_estimates_status_check
  check (status in ('in_service','turning','parked_assumed','absent','last_known','maintenance_possible','unknown'));
alter table public.vehicles drop constraint vehicles_status_check;
alter table public.vehicles add constraint vehicles_status_check
  check (status in ('in_service','turning','parked_assumed','absent','last_known','maintenance_possible','unknown'));
alter table public.parking_estimates
  add column trip_id text,
  add column line_id text,
  add column train_number text,
  add column origin_name text,
  add column arrived_at timestamptz,
  add column returns_total int,   -- Abfahrten am Endbahnhof bis 40 min nach Ankunft
  add column returns_read int,    -- davon mit gelesener Wagenreihung (alle ohne dieses Fahrzeug)
  add column later_total int,     -- spätere Abfahrten dort bis jetzt
  add column later_read int;

create or replace function private.update_parking_estimates() returns int
language plpgsql security definer set search_path = '' as $$
declare n int; v_cov numeric; v_cov_n int; v_fresh boolean;
begin
  create temp table pg_temp._st on commit drop as
  with tr as (
    -- je Fahrt nur die zuletzt aktualisierte Kopie
    select distinct on (t.service_date, t.line_id, t.train_number) t.*
    from public.trips t where t.first_dep > now() - interval '4 days' and t.train_number is not null
    order by t.service_date, t.line_id, t.train_number, (t.source = 'efa_nvbw') desc, t.updated_at desc
  ), fm as (
    select distinct on (t.service_date, t.line_id, t.train_number) t.service_date, t.line_id, t.train_number, f.vehicles
    from public.formations f join public.trips t on t.id = f.trip_id
    where t.first_dep > now() - interval '4 days' and cardinality(f.vehicles) > 0
    order by t.service_date, t.line_id, t.train_number, f.observed_at desc
  )
  select tr.id, tr.line_id, tr.train_number, tr.origin_name, tr.destination_name, tr.first_dep, tr.last_arr, tr.cancelled, fm.vehicles,
    o.station_id as from_id, e.station_id as to_id, coalesce(e.arr_planned, tr.last_arr) as planned_arr
  from tr
  left join fm on fm.service_date = tr.service_date and fm.line_id is not distinct from tr.line_id and fm.train_number = tr.train_number
  left join lateral (select s.station_id from public.trip_stops s where s.trip_id = tr.id and not coalesce(s.cancelled, false) order by s.seq limit 1) o on true
  left join lateral (select s.station_id, s.arr_planned from public.trip_stops s
    where s.trip_id = tr.id and not coalesce(s.cancelled, false) and (tr.stop_count is null or s.seq < tr.stop_count) order by s.seq desc limit 1) e on true
  where not tr.cancelled;

  -- Anteil gelesener Fahrten der letzten 45 min (Wendezeit inbegriffen): Grundlage für „nicht im Einsatz“
  select avg((vehicles is not null)::int), count(*) into v_cov, v_cov_n
  from pg_temp._st where first_dep <= now() - interval '5 minutes' and last_arr >= now() - interval '45 minutes';
  -- Ohne aktuellen Fahrplanabruf ist „keine Abfahrt“ keine Aussage
  v_fresh := exists (select 1 from public.collector_runs where source = 'efa_nvbw' and ok and finished_at > now() - interval '15 minutes');

  with last as (
    select distinct on (u.v) u.v as vehicle_id, s.* from pg_temp._st s, unnest(s.vehicles) u(v)
    where s.first_dep <= now() + interval '15 minutes' order by u.v, s.first_dep desc
  ), ev as (
    select l.*, d.rt, d.rr, d.lt, d.lr from last l left join lateral (
      select count(*) filter (where d.first_dep <= l.last_arr + interval '40 minutes') as rt,
        count(*) filter (where d.first_dep <= l.last_arr + interval '40 minutes' and d.vehicles is not null) as rr,
        count(*) filter (where d.first_dep > l.last_arr + interval '40 minutes') as lt,
        count(*) filter (where d.first_dep > l.last_arr + interval '40 minutes' and d.vehicles is not null) as lr
      from pg_temp._st d where d.from_id = l.to_id and d.id <> l.id and d.first_dep between l.planned_arr - interval '3 minutes' and now()) d on true
  ), sc as (
    select ev.*, case when last_arr is null or to_id is null then 0 else round(
        0.9 * (case when rt = 0 then 0.85 else rr::numeric / rt end) * (0.35 + 0.65 * (case when lt = 0 then 1 else lr::numeric / lt end))
        * (case when v_fresh then 1 else 0.5 end), 2) end as conf
    from ev
  ), res as (
    select sc.*, case
        when last_arr > now() then 'in_service'
        when last_arr > now() - interval '40 minutes' then 'turning'
        when conf >= 0.5 then 'parked_assumed'
        when v_cov_n >= 10 and v_cov >= 0.85 then 'absent'
        else 'unknown' end as st
    from sc
  )
  insert into public.parking_estimates as p (vehicle_id, station_id, station_name, status, confidence, last_sighting_at, reason, estimated_at,
    trip_id, line_id, train_number, origin_name, arrived_at, returns_total, returns_read, later_total, later_read)
  select r.vehicle_id, r.to_id, r.destination_name, r.st,
    case r.st when 'in_service' then 0.9 when 'turning' then 0.5 when 'absent' then round(0.9 * v_cov, 2) else r.conf end,
    v.last_seen,
    case r.st
      when 'in_service' then 'Fahrt laut Fahrplan/Echtzeit noch nicht beendet'
      when 'turning' then 'Vor weniger als 40 min angekommen, Rückfahrt noch möglich'
      when 'parked_assumed' then case when r.rt = 0 then 'Nach der Ankunft fuhr dort kein Zug mehr ab'
        else format('In keiner der %s gelesenen Abfahrten danach enthalten (von %s)', r.rr + r.lr, r.rt + r.lt) end
      when 'absent' then format('In keinem der zuletzt fahrenden Züge enthalten (%s %% gelesen), Standort unsicher', round(v_cov * 100))
      else format('Zu wenige Abfahrten gelesen (%s von %s)', r.rr + r.lr, r.rt + r.lt) end,
    now(), r.id, r.line_id, r.train_number, r.origin_name, r.last_arr, r.rt, r.rr, r.lt, r.lr
  from res r join public.vehicles v on v.id = r.vehicle_id
  on conflict (vehicle_id) do update set station_id = excluded.station_id, station_name = excluded.station_name, status = excluded.status,
    confidence = excluded.confidence, last_sighting_at = excluded.last_sighting_at, reason = excluded.reason, estimated_at = now(),
    trip_id = excluded.trip_id, line_id = excluded.line_id, train_number = excluded.train_number, origin_name = excluded.origin_name,
    arrived_at = excluded.arrived_at, returns_total = excluded.returns_total, returns_read = excluded.returns_read,
    later_total = excluded.later_total, later_read = excluded.later_read;
  get diagnostics n = row_count;

  -- Seit mehr als 4 Tagen nicht gesehen: keine Aussage mehr
  update public.parking_estimates set status = 'unknown', confidence = 0.1, reason = 'Seit mehr als 4 Tagen nicht gesehen', estimated_at = now()
    where estimated_at < now() and status <> 'unknown';
  update public.vehicles v set status = p.status from public.parking_estimates p where p.vehicle_id = v.id and v.status <> p.status;
  drop table pg_temp._st;
  return n;
end $$;

-- Abgestellte Fahrzeuge für Karte und Liste (nur freigeschaltete Konten, RLS)
create or replace function public.get_parked_vehicles() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle_id', p.vehicle_id, 'status', p.status, 'confidence', p.confidence, 'reason', p.reason,
    'station_id', p.station_id, 'station_name', p.station_name, 'arrived_at', p.arrived_at,
    'line_id', p.line_id, 'train_number', p.train_number, 'origin_name', p.origin_name, 'estimated_at', p.estimated_at,
    'site_kind', coalesce(s.kind, 'station'), 'lat', coalesce(s.lat, st.lat), 'lon', coalesce(s.lon, st.lon)
  ) order by p.station_name, p.arrived_at desc, p.vehicle_id), '[]'::jsonb)
  from public.parking_estimates p
  left join public.stabling_sites s on s.station_id = p.station_id
  left join public.stations st on st.id = p.station_id
  where p.status in ('parked_assumed', 'absent');
$$;
revoke all on function public.get_parked_vehicles() from public, anon;
grant execute on function public.get_parked_vehicles() to authenticated, service_role;

select cron.schedule('parking-estimates', '*/5 * * * *', $$select private.update_parking_estimates()$$);
