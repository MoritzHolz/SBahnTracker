-- Ergebnisse der unabhängigen QA-Prüfung

-- Rechte härten (RLS greift nicht bei TRUNCATE)
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Indizes
create index if not exists trips_last_arr_idx on public.trips (last_arr);
create index if not exists formations_vehicles_gin on public.formations using gin (vehicles);

-- Ingest: Fehler pro Fahrt isoliert, unveränderte Halte nicht neu schreiben (Bloat), Echtzeit nicht festhalten
create or replace function public.ingest_trips(p_trips jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare t jsonb; n int := 0;
begin
  for t in select * from jsonb_array_elements(p_trips) loop
    begin
      insert into public.trips as tr (id, service_date, line_id, transport_id, trip_code, train_number, origin_name, destination_name,
        direction, first_dep, last_arr, has_realtime, cancelled, source, updated_at, shape_id, stop_count)
      values (t->>'id', (t->>'service_date')::date,
        case when exists(select 1 from public.lines l where l.id = t->>'line_id') then t->>'line_id' end,
        t->>'transport_id', (t->>'trip_code')::int, t->>'train_number', t->>'origin_name', t->>'destination_name',
        t->>'direction', (t->>'first_dep')::timestamptz, (t->>'last_arr')::timestamptz,
        coalesce((t->>'has_realtime')::boolean, false), coalesce((t->>'cancelled')::boolean, false), 'efa_nvbw', now(),
        (select rs.id from public.route_shapes rs where rs.signature = t->>'shape_signature'),
        jsonb_array_length(t->'stops'))
      on conflict (id) do update set
        train_number = coalesce(excluded.train_number, tr.train_number),
        origin_name = excluded.origin_name, destination_name = excluded.destination_name,
        first_dep = excluded.first_dep, last_arr = excluded.last_arr,
        has_realtime = excluded.has_realtime, cancelled = excluded.cancelled, updated_at = now(),
        shape_id = coalesce(excluded.shape_id, tr.shape_id), stop_count = excluded.stop_count;

      insert into public.trip_stops as ts (trip_id, seq, station_id, station_name, platform_id, lat, lon, platform, planned_platform,
        arr_planned, arr_est, dep_planned, dep_est, cancelled)
      select t->>'id', (s->>'seq')::int, s->>'station_id', s->>'station_name', s->>'platform_id',
        (s->>'lat')::float8, (s->>'lon')::float8, s->>'platform', s->>'planned_platform',
        (s->>'arr_planned')::timestamptz, (s->>'arr_est')::timestamptz, (s->>'dep_planned')::timestamptz, (s->>'dep_est')::timestamptz,
        coalesce((s->>'cancelled')::boolean, false)
      from jsonb_array_elements(t->'stops') s
      on conflict (trip_id, seq) do update set
        station_id = excluded.station_id, station_name = excluded.station_name, platform_id = excluded.platform_id,
        lat = excluded.lat, lon = excluded.lon, platform = excluded.platform, planned_platform = excluded.planned_platform,
        arr_planned = excluded.arr_planned, arr_est = excluded.arr_est,
        dep_planned = excluded.dep_planned, dep_est = excluded.dep_est, cancelled = excluded.cancelled
      where (ts.station_id, ts.platform, ts.planned_platform, ts.arr_planned, ts.arr_est, ts.dep_planned, ts.dep_est, ts.cancelled)
        is distinct from (excluded.station_id, excluded.platform, excluded.planned_platform, excluded.arr_planned, excluded.arr_est, excluded.dep_planned, excluded.dep_est, excluded.cancelled);

      insert into public.stations (id, name, lat, lon, updated_at)
      select distinct on (s->>'station_id') s->>'station_id', s->>'station_name', (s->>'lat')::float8, (s->>'lon')::float8, now()
      from jsonb_array_elements(t->'stops') s where s->>'lat' is not null
      on conflict (id) do nothing;
      n := n + 1;
    exception when others then
      raise warning 'ingest_trips: trip % übersprungen: %', t->>'id', sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- Live-Abfrage: nach unten begrenzt (Index nutzbar)
create or replace function public.get_live_trips(p_now timestamptz default now())
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(t order by t->>'line_id', t->>'id'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', tr.id, 'line_id', tr.line_id, 'train_number', tr.train_number, 'trip_code', tr.trip_code,
      'origin_name', tr.origin_name, 'destination_name', tr.destination_name, 'direction', tr.direction,
      'shape_id', tr.shape_id, 'has_realtime', tr.has_realtime, 'cancelled', tr.cancelled,
      'updated_at', tr.updated_at, 'source', tr.source,
      'stops', (select jsonb_agg(jsonb_build_object(
          'seq', s.seq, 'station_id', s.station_id, 'station_name', s.station_name, 'lat', s.lat, 'lon', s.lon,
          'platform', s.platform, 'planned_platform', s.planned_platform,
          'arr_planned', s.arr_planned, 'arr_est', s.arr_est, 'dep_planned', s.dep_planned, 'dep_est', s.dep_est,
          'cancelled', s.cancelled) order by s.seq) from public.trip_stops s
          where s.trip_id = tr.id and (tr.stop_count is null or s.seq < tr.stop_count)),
      'formation', (select jsonb_build_object('vehicles', f.vehicles, 'observed_at', f.observed_at, 'station_name', f.station_name, 'source', f.source)
          from public.formations f where f.trip_id = tr.id order by f.observed_at desc limit 1)
    ) as t
    from public.trips tr
    where tr.first_dep between p_now - interval '6 hours' and p_now + interval '10 minutes'
      and coalesce(tr.last_arr, tr.first_dep) >= p_now - interval '10 minutes'
  ) x;
$$;

-- Nur fehlende Shapes nachladen (Traffic sparen)
create or replace function public.get_route_shapes_by_ids(p_ids bigint[])
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'line_id', line_id, 'coords', coords, 'stop_ids', stop_ids, 'length_m', length_m)), '[]'::jsonb)
  from public.route_shapes where id = any(p_ids[1:200]);
$$;
grant execute on function public.get_route_shapes_by_ids(bigint[]) to anon, authenticated;

-- Fahrzeugsuche: min. 3 Zeichen, Wildcards maskiert, max. 20 Treffer, GIN-gestützte Split-Suche
create or replace function public.search_vehicle(p_query text)
returns jsonb language sql stable set search_path = '' as $$
  with q as (
    select replace(replace(replace(replace(coalesce(p_query, ''), ' ', ''), '\', '\\'), '%', '\%'), '_', '\_') as pat
  ), hits as (
    select v.* from public.vehicles v, q
    where length(q.pat) >= 3 and replace(v.id, ' ', '') ilike '%' || q.pat || '%'
    order by v.last_seen desc nulls last limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle', to_jsonb(v),
    'parking', (select to_jsonb(p) from public.parking_estimates p where p.vehicle_id = v.id),
    'sightings', (select coalesce(jsonb_agg(to_jsonb(s) order by s.observed_at desc), '[]'::jsonb)
                  from (select * from public.vehicle_sightings s where s.vehicle_id = v.id order by observed_at desc limit 200) s),
    'splits', (select coalesce(jsonb_agg(to_jsonb(e) order by e.detected_at desc), '[]'::jsonb)
               from public.split_events e
               where exists (select 1 from public.formations f where f.id in (e.prev_formation_id, e.curr_formation_id) and f.vehicles @> array[v.id]))
  )), '[]'::jsonb)
  from hits v;
$$;

-- Status: interne Fehlertexte nicht öffentlich; collector_runs nicht mehr direkt lesbar
create or replace function public.get_source_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'live', (select jsonb_build_object('source', source, 'started_at', started_at, 'finished_at', finished_at, 'ok', ok, 'trips_seen', trips_seen,
                    'error', case when error is not null then 'Abruf fehlgeschlagen' end)
             from public.collector_runs where source = 'efa_nvbw' order by started_at desc limit 1),
    'last_ok', (select max(finished_at) from public.collector_runs where source = 'efa_nvbw' and ok),
    'formation_source', jsonb_build_object('available', exists(select 1 from public.formations), 'note', 'Keine frei zugängliche, zulässige Quelle für Fahrzeugnummern/Wagenreihung der S-Bahn Stuttgart angebunden.')
  );
$$;
grant execute on function public.get_source_status() to anon, authenticated;
revoke select on public.collector_runs from anon, authenticated;
