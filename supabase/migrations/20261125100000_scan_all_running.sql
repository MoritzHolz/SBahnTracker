-- Scanner: alle gerade fahrenden Züge, S1/S2/S3 zuerst.
-- Außerdem: Nach einem Fahrplanwechsel vergibt EFA neue Fahrt-IDs. Dieselbe Fahrt lag dann doppelt vor (doppelt auf
-- der Karte), und die Wagenreihung hing an der veralteten Kopie. Es wird nichts gelöscht.

-- ===== Karte: von mehreren Kopien einer Fahrt nur die zuletzt aktualisierte zeigen, samt Daten der anderen =====
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
          from public.formations f where f.trip_id = any(array_append(tw.ids, tr.id)) order by f.observed_at desc limit 1),
      'web', (select jsonb_build_object('first_seen_at', w.first_seen_at, 'last_seen_at', w.last_seen_at, 'run_id', w.last_run_id,
            'delay_min', w.delay_min, 'platform', w.platform, 'board_station_id', w.board_station_id, 'board_station_name', w.board_station_name, 'cancelled', w.cancelled,
            'message', w.message, 'quality', w.quality, 'missing', w.missing, 'vehicle_state', w.vehicle_state, 'source', w.source)
          from public.web_trains w where w.trip_id = any(array_append(tw.ids, tr.id)) order by w.last_seen_at desc limit 1)
    ) as t
    from public.trips tr
    cross join lateral (
      select array_agg(n.id) as ids, coalesce(bool_or((n.updated_at, n.first_seen, n.id) > (tr.updated_at, tr.first_seen, tr.id)), false) as superseded
      from public.trips n
      where n.train_number = tr.train_number and n.service_date = tr.service_date and n.id <> tr.id
        and n.line_id is not distinct from tr.line_id and n.source = tr.source
        and n.first_dep between tr.first_dep - interval '30 minutes' and tr.first_dep + interval '30 minutes'
    ) tw
    where tr.first_dep between p_now - interval '6 hours' and p_now + interval '10 minutes'
      and coalesce(tr.last_arr, tr.first_dep) >= p_now - interval '10 minutes'
      and not tw.superseded
      and not (tr.source = 'web_dbf' and exists (select 1 from public.trips o
        where o.source = 'efa_nvbw' and o.service_date = tr.service_date and o.train_number = tr.train_number))
  ) x;
$$;

-- ===== Zuordnung: bei mehreren Kopien die zuletzt aktualisierte =====
create or replace function private.web_match_trip(p_train text, p_line text, p_planned timestamptz) returns public.trips
language sql stable security definer set search_path = '' as $$
  select t from public.trips t
  where t.train_number = p_train
    and (p_line is null or t.line_id is null or t.line_id = p_line)
    and t.first_dep <= p_planned + interval '20 minutes'
    and coalesce(t.last_arr, t.first_dep) >= p_planned - interval '20 minutes'
  order by (t.source = 'efa_nvbw') desc, abs(extract(epoch from t.first_dep - p_planned)), t.updated_at desc, t.first_seen desc limit 1;
$$;

-- Wechselt die Fahrt-ID, ziehen Wagenreihung und Sichtungen mit um (bisher nur bei Ersatzfahrten des Scanners)
do $$
declare v_def text := pg_get_functiondef('public.scanner_worker_ingest(text,bigint,jsonb,jsonb)'::regprocedure);
  v_old constant text := $q$v_old.trip_id <> v_trip_id and v_old.trip_id like '%|web|%' then$q$;
  v_new constant text := $q$v_old.trip_id <> v_trip_id then$q$;
begin
  if position(v_new in v_def) > 0 then return; end if;
  if position(v_old in v_def) = 0 then raise exception 'scanner_worker_ingest hat einen unerwarteten Stand'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ===== Reihenfolge und Auswahl der Wagenreihungen =====
-- Alle Fahrten, die gerade unterwegs sind oder in 10 min beginnen. Reihenfolge nach lines.sort: S1, S2, S3, danach die übrigen Linien.
create or replace function public.scanner_worker_formation_targets(p_secret text, p_run_id bigint, p_trains text[], p_limit int default 8) returns text[]
language plpgsql security definer set search_path = '' as $$
begin
  if not private.scanner_require_run(p_secret, p_run_id) then return null; end if;
  return (select coalesce(array_agg(x.train_number order by x.sort, x.line_id, x.dist), '{}') from (
    select w.train_number, w.line_id, coalesce(l.sort, 999) as sort,
      abs(extract(epoch from coalesce(w.dep_planned, w.arr_planned) - now())) as dist
    from public.web_trains w
    join public.trips t on t.id = w.trip_id
    left join public.lines l on l.id = w.line_id
    where w.train_number = any(p_trains) and not w.cancelled
      and w.vehicle_state <> 'available' and w.vehicle_attempts < 3
      and (w.vehicle_checked_at is null or w.vehicle_checked_at < now() - interval '8 minutes')
      and t.first_dep <= now() + interval '10 minutes'
      -- 10 min Reserve für Verspätung ohne Echtzeitangabe
      and coalesce(t.last_arr, t.first_dep) + make_interval(mins => greatest(coalesce(w.delay_min, 0), 0)) >= now() - interval '10 minutes'
    order by 3, 2, 4
    limit least(greatest(p_limit, 0), 70)) x);
end $$;
