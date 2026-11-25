-- Abstellprotokoll: Überführungen. Fuhr ein abgestelltes Fahrzeug als Nächstes ab einem Überführungsbahnhof (Vaihingen) los,
-- gilt es als dorthin überführt und dort abgestellt. Die Überführung selbst ist nicht beobachtet (Annahme), die Abfahrt dort schon.

-- ---------------------------------------------------------------- Überführungsbahnhöfe
create table public.stabling_transfer_sites (
  station_id text primary key,
  station_name text not null
);
alter table public.stabling_transfer_sites enable row level security;
revoke all on public.stabling_transfer_sites from anon, authenticated;
create policy stabling_transfer_sites_read on public.stabling_transfer_sites for select to authenticated using ((select public.is_member()));
grant select on public.stabling_transfer_sites to authenticated;
insert into public.stabling_transfer_sites values ('de:08111:6002', 'Vaihingen');

-- ---------------------------------------------------------------- Nächste Fahrt merken, auch wenn sie woanders begann
alter table public.stabling_events
  add column seen_again_station_id text,
  add column next_line_id text,
  add column next_train_number text,
  add column next_destination text,
  add column next_platform text;

do $x$
declare d text := pg_get_functiondef('private.update_parking_estimates(timestamptz)'::regprocedure);
  r text[][] := array[
    ['seen_again_at, seen_again_station, confidence, moved_at, first_detected_at, updated_at)',
     'seen_again_at, seen_again_station, seen_again_station_id, next_line_id, next_train_number, next_destination, next_platform, confidence, moved_at, first_detected_at, updated_at)'],
    ['    case when x.ended then x.b_from_name end,',
     E'    case when x.ended then x.b_from_name end,\n    case when x.ended then x.b_from end, case when x.ended then x.b_line end, case when x.ended then x.b_train end,\n    case when x.ended then x.b_dest end, case when x.ended then x.b_platform end,'],
    ['seen_again_station = excluded.seen_again_station,',
     E'seen_again_station = excluded.seen_again_station,\n    seen_again_station_id = excluded.seen_again_station_id, next_line_id = excluded.next_line_id, next_train_number = excluded.next_train_number,\n    next_destination = excluded.next_destination, next_platform = excluded.next_platform,'],
    ['seen_again_station = t.from_name,',
     E'seen_again_station = t.from_name, seen_again_station_id = t.from_id, next_line_id = t.line_id, next_train_number = t.train_number,\n    next_destination = t.destination_name, next_platform = t.dep_platform,']
  ];
begin
  for i in 1 .. array_length(r, 1) loop
    if position(r[i][1] in d) = 0 then raise exception 'Textstelle % nicht gefunden', i; end if;
    d := replace(d, r[i][1], r[i][2]);
  end loop;
  execute d;
end $x$;

-- Rückwirkend: nächste Fahrt der bisherigen Einträge
update public.stabling_events e set seen_again_station_id = m.station_id, next_line_id = m.line_id, next_train_number = m.train_number,
  next_destination = m.destination_name, next_platform = m.platform
from (
  select distinct on (e.id) e.id, o.station_id, t.line_id, t.train_number, t.destination_name, o.platform
  from public.stabling_events e
  join public.formations f on e.vehicle_id = any (f.vehicles)
  join public.trips t on t.id = f.trip_id and t.first_dep > e.arrived_at and t.first_dep < e.seen_again_at + interval '1 hour' and t.train_number is not null
  join lateral (select s.station_id, coalesce(s.platform, s.planned_platform) as platform, coalesce(s.dep_est, s.dep_planned) as dep from public.trip_stops s
    where s.trip_id = t.id and not coalesce(s.cancelled, false) order by s.seq limit 1) o on true
  where e.seen_again_at is not null and e.seen_again_station_id is null
    and abs(extract(epoch from greatest(coalesce(o.dep, t.first_dep), t.first_dep) - e.seen_again_at)) < 90
  order by e.id, (t.source = 'efa_nvbw') desc, t.updated_at desc
) m where m.id = e.id;

