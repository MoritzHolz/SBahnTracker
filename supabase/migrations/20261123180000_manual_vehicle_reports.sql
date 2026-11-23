-- Manuelle Fahrzeugmeldungen (PIN-geschützt), da keine zulässige automatische Quelle existiert.
-- Den PIN-Hash setzen (Klartext-PIN nicht ins Repo!):
--   insert into private.app_config (key, value) values ('report_pin_hash', extensions.crypt('<PIN>', extensions.gen_salt('bf', 10)))
--   on conflict (key) do update set value = excluded.value;

create extension if not exists pgcrypto with schema extensions;

create table if not exists private.report_attempts (
  id bigserial primary key,
  at timestamptz not null default now(),
  ok boolean not null
);

create or replace function private.normalize_vehicle(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^\d{6}$'
      then substr(regexp_replace(p, '\D', '', 'g'), 1, 3) || ' ' || substr(regexp_replace(p, '\D', '', 'g'), 4, 3)
    else null end;
$$;

-- Fehler werden als JSON zurückgegeben (kein raise), damit das Fehlversuchs-Protokoll nicht zurückgerollt wird.
create or replace function public.report_formation(p_pin text, p_trip_id text, p_vehicles text[], p_station_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hash text; v_ok boolean; v_vehicles text[]; v_bad text[]; v_station_name text; v_id bigint; v_fails int; v_recent int;
begin
  select count(*) into v_fails from private.report_attempts where not ok and at > now() - interval '1 hour';
  if v_fails >= 10 then
    return jsonb_build_object('error', 'Zu viele falsche PIN-Eingaben. Bitte in einer Stunde erneut versuchen.');
  end if;

  select value into v_hash from private.app_config where key = 'report_pin_hash';
  v_ok := v_hash is not null and extensions.crypt(coalesce(p_pin, ''), v_hash) = v_hash;
  insert into private.report_attempts (ok) values (v_ok);
  if not v_ok then
    return jsonb_build_object('error', 'PIN falsch.');
  end if;

  select count(*) into v_recent from public.formations where source = 'manual' and observed_at > now() - interval '10 minutes';
  if v_recent >= 30 then
    return jsonb_build_object('error', 'Zu viele Meldungen in kurzer Zeit.');
  end if;

  if not exists (select 1 from public.trips where id = p_trip_id) then
    return jsonb_build_object('error', 'Fahrt nicht gefunden.');
  end if;

  select array_agg(private.normalize_vehicle(x)), array_agg(x) filter (where private.normalize_vehicle(x) is null)
    into v_vehicles, v_bad
  from unnest(p_vehicles) x where trim(x) <> '';
  if v_bad is not null then
    return jsonb_build_object('error', format('Ungültige Fahrzeugnummer(n): %s. Erwartet z. B. 423 502.', array_to_string(v_bad, ', ')));
  end if;
  if coalesce(cardinality(v_vehicles), 0) = 0 or cardinality(v_vehicles) > 12 then
    return jsonb_build_object('error', 'Bitte 1 bis 12 Fahrzeugnummern angeben.');
  end if;

  if p_station_id is not null then
    select station_name into v_station_name from public.trip_stops where trip_id = p_trip_id and station_id = p_station_id limit 1;
  end if;

  insert into public.formations (trip_id, station_id, station_name, observed_at, vehicles, source)
  values (p_trip_id, p_station_id, v_station_name, now(), v_vehicles, 'manual')
  returning id into v_id;

  return jsonb_build_object('formation_id', v_id, 'vehicles', v_vehicles);
end $$;
revoke all on function public.report_formation(text, text, text[], text) from public;
grant execute on function public.report_formation(text, text, text[], text) to anon, authenticated;

-- Zugtrennung: Meldungen erfolgen je Einheit (nicht je Wagen) → 4-Wagen-Regel entfällt, manuelle Meldungen vorsichtiger
create or replace function private.on_formation_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev public.formations%rowtype;
  v_missing text[]; v_new text[]; v_order boolean; v_kind text; v_conf numeric;
  v_vid text; v_pos int := 0;
begin
  if coalesce(array_length(new.vehicles, 1), 0) = 0 then
    return new;
  end if;

  foreach v_vid in array new.vehicles loop
    v_pos := v_pos + 1;
    insert into public.vehicles (id, vehicle_type_id, first_seen, last_seen, last_trip_id, last_station_id, last_station_name, status)
    values (v_vid, case when left(v_vid, 3) in ('423','433') then '423' when left(v_vid, 3) = '430' then '430' end,
            new.observed_at, new.observed_at, new.trip_id, new.station_id, new.station_name, 'in_service')
    on conflict (id) do update set
      last_seen = greatest(public.vehicles.last_seen, excluded.last_seen),
      last_trip_id = case when excluded.last_seen >= coalesce(public.vehicles.last_seen, excluded.last_seen) then excluded.last_trip_id else public.vehicles.last_trip_id end,
      last_station_id = case when excluded.last_seen >= coalesce(public.vehicles.last_seen, excluded.last_seen) then excluded.last_station_id else public.vehicles.last_station_id end,
      last_station_name = case when excluded.last_seen >= coalesce(public.vehicles.last_seen, excluded.last_seen) then excluded.last_station_name else public.vehicles.last_station_name end,
      status = 'in_service';
    insert into public.vehicle_sightings (vehicle_id, trip_id, formation_id, station_id, station_name, observed_at, position_in_formation, source)
    values (v_vid, new.trip_id, new.id, new.station_id, new.station_name, new.observed_at, v_pos, new.source);
  end loop;

  select * into v_prev from public.formations f
  where f.trip_id = new.trip_id and f.id <> new.id and f.observed_at < new.observed_at
    and coalesce(array_length(f.vehicles, 1), 0) > 0
  order by f.observed_at desc limit 1;
  if not found then return new; end if;

  select coalesce(array_agg(x), '{}') into v_missing from unnest(v_prev.vehicles) x where x <> all(new.vehicles);
  select coalesce(array_agg(x), '{}') into v_new from unnest(new.vehicles) x where x <> all(v_prev.vehicles);
  v_order := cardinality(v_missing) = 0 and cardinality(v_new) = 0 and v_prev.vehicles <> new.vehicles;
  if cardinality(v_missing) = 0 and cardinality(v_new) = 0 and not v_order then return new; end if;

  v_kind := case
    when cardinality(v_missing) > 0 and cardinality(v_new) = 0 then 'possible_split'
    when cardinality(v_new) > 0 and cardinality(v_missing) = 0 then 'possible_join'
    when v_order then 'order_change'
    else 'composition_change' end;

  v_conf := 0.5
    + case when v_prev.station_id is distinct from new.station_id then 0.15 else -0.15 end
    - case when v_kind = 'composition_change' then 0.2 else 0 end
    - case when new.source = 'manual' or v_prev.source = 'manual' then 0.1 else 0 end;
  v_conf := least(0.9, greatest(0.1, v_conf));

  insert into public.split_events (trip_id, prev_formation_id, curr_formation_id, station_id, station_name, missing_vehicles, new_vehicles, order_changed, kind, confidence)
  values (new.trip_id, v_prev.id, new.id, new.station_id, new.station_name, v_missing, v_new, v_order, v_kind, v_conf)
  on conflict do nothing;
  return new;
end $$;

-- Fahrtenbuch mit Linie/Zugnummer/Ziel anreichern
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
    'vehicle', to_jsonb(v) || jsonb_build_object(
        'last_line_id', (select t.line_id from public.trips t where t.id = v.last_trip_id),
        'last_train_number', (select t.train_number from public.trips t where t.id = v.last_trip_id),
        'last_destination', (select t.destination_name from public.trips t where t.id = v.last_trip_id)),
    'parking', (select to_jsonb(p) from public.parking_estimates p where p.vehicle_id = v.id),
    'sightings', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
                      'line_id', t.line_id, 'train_number', t.train_number, 'origin_name', t.origin_name,
                      'destination_name', t.destination_name, 'first_dep', t.first_dep, 'last_arr', t.last_arr,
                      'formation', (select f.vehicles from public.formations f where f.id = s.formation_id))
                    order by s.observed_at desc), '[]'::jsonb)
                  from (select * from public.vehicle_sightings s where s.vehicle_id = v.id order by observed_at desc limit 200) s
                  left join public.trips t on t.id = s.trip_id),
    'splits', (select coalesce(jsonb_agg(to_jsonb(e) order by e.detected_at desc), '[]'::jsonb)
               from public.split_events e
               where exists (select 1 from public.formations f where f.id in (e.prev_formation_id, e.curr_formation_id) and f.vehicles @> array[v.id]))
  )), '[]'::jsonb)
  from hits v;
$$;

create or replace function public.get_source_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'live', (select jsonb_build_object('source', source, 'started_at', started_at, 'finished_at', finished_at, 'ok', ok, 'trips_seen', trips_seen,
                    'error', case when error is not null then 'Abruf fehlgeschlagen' end)
             from public.collector_runs where source = 'efa_nvbw' order by started_at desc limit 1),
    'last_ok', (select max(finished_at) from public.collector_runs where source = 'efa_nvbw' and ok),
    'formation_source', jsonb_build_object(
      'available', exists(select 1 from public.formations),
      'manual_reporting', true,
      'note', 'Fahrzeugnummern stammen aus eigenen Meldungen (manuell, per PIN). Eine automatische, zulässige Quelle ist nicht angebunden.')
  );
$$;
