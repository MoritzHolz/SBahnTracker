-- Interner Bereich (nicht über die API erreichbar)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_config (key text primary key, value text not null);
-- Shared Secret zwischen pg_cron und Edge Function "collect"
insert into private.app_config values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'));

-- ===== Öffentliche Lese-API (RPC) =====

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
    where tr.first_dep <= p_now + interval '10 minutes'
      and coalesce(tr.last_arr, tr.first_dep) >= p_now - interval '10 minutes'
  ) x;
$$;

create or replace function public.get_route_shapes()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'line_id', line_id, 'coords', coords, 'stop_ids', stop_ids, 'length_m', length_m)), '[]'::jsonb)
  from public.route_shapes;
$$;

create or replace function public.get_source_status()
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'live', (select jsonb_build_object('source', source, 'started_at', started_at, 'finished_at', finished_at, 'ok', ok, 'trips_seen', trips_seen, 'error', error)
             from public.collector_runs where source = 'efa_nvbw' order by started_at desc limit 1),
    'last_ok', (select max(finished_at) from public.collector_runs where source = 'efa_nvbw' and ok),
    'formation_source', jsonb_build_object('available', exists(select 1 from public.formations), 'note', 'Keine frei zugängliche, zulässige Quelle für Fahrzeugnummern/Wagenreihung der S-Bahn Stuttgart angebunden.')
  );
$$;

create or replace function public.search_vehicle(p_query text)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle', to_jsonb(v),
    'parking', (select to_jsonb(p) from public.parking_estimates p where p.vehicle_id = v.id),
    'sightings', (select coalesce(jsonb_agg(to_jsonb(s) order by s.observed_at desc), '[]'::jsonb) from (select * from public.vehicle_sightings s where s.vehicle_id = v.id order by observed_at desc limit 200) s),
    'splits', (select coalesce(jsonb_agg(to_jsonb(e) order by e.detected_at desc), '[]'::jsonb) from public.split_events e join public.formations f on f.id in (e.prev_formation_id, e.curr_formation_id) where v.id = any(f.vehicles))
  )), '[]'::jsonb)
  from public.vehicles v
  where replace(v.id, ' ', '') ilike '%' || replace(p_query, ' ', '') || '%';
$$;

grant execute on function public.get_live_trips(timestamptz), public.get_route_shapes(), public.get_source_status(), public.search_vehicle(text) to anon, authenticated;

-- ===== Schreib-API für den Collector (nur service_role) =====

create or replace function public.collector_auth(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.app_config where key = 'cron_secret' and value = p_secret);
$$;

create or replace function public.ingest_trips(p_trips jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare t jsonb; n int := 0;
begin
  for t in select * from jsonb_array_elements(p_trips) loop
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
      arr_planned = excluded.arr_planned, arr_est = coalesce(excluded.arr_est, ts.arr_est),
      dep_planned = excluded.dep_planned, dep_est = coalesce(excluded.dep_est, ts.dep_est), cancelled = excluded.cancelled;

    insert into public.stations (id, name, lat, lon, updated_at)
    select distinct on (s->>'station_id') s->>'station_id', s->>'station_name', (s->>'lat')::float8, (s->>'lon')::float8, now()
    from jsonb_array_elements(t->'stops') s where s->>'lat' is not null
    on conflict (id) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.missing_shape_signatures(p_signatures text[])
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s), '{}') from unnest(p_signatures) s
  where not exists (select 1 from public.route_shapes r where r.signature = s);
$$;

create or replace function public.store_shape(p_line_id text, p_signature text, p_coords jsonb, p_stop_ids text[], p_length double precision)
returns bigint language sql security definer set search_path = '' as $$
  insert into public.route_shapes (line_id, signature, coords, stop_ids, length_m)
  values (case when exists(select 1 from public.lines l where l.id = p_line_id) then p_line_id end, p_signature, p_coords, p_stop_ids, p_length)
  on conflict (signature) do update set coords = excluded.coords, stop_ids = excluded.stop_ids, length_m = excluded.length_m, fetched_at = now()
  returning id;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.collector_auth(text)','public.ingest_trips(jsonb)','public.missing_shape_signatures(text[])',
    'public.store_shape(text, text, jsonb, text[], double precision)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ===== Collector-Trigger (pg_cron → pg_net → Edge Function) =====

create or replace function private.trigger_collector() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://ytggyjckyslohbdkievd.supabase.co/functions/v1/collect',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-collector-secret', (select value from private.app_config where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$;

-- ===== Fahrzeug-Analytik: siehe 20261123150200_vehicle_analytics.sql =====

select cron.schedule('collect-efa', '*/3 * * * *', $$select private.trigger_collector()$$);
