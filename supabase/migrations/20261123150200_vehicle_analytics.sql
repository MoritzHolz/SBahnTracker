-- Wagenreihungsvergleich / Zugtrennungserkennung / Abstellort-Schätzung
-- Arbeitet auf public.formations. Solange keine Wagenreihungsquelle angebunden ist, bleiben die Tabellen leer.

-- Beim Eintragen einer Wagenreihung: Fahrzeuge + Sichtungen pflegen und mit voriger Erfassung derselben Fahrt vergleichen.
create or replace function private.on_formation_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev public.formations%rowtype;
  v_missing text[]; v_new text[]; v_order boolean; v_kind text; v_conf numeric;
  v_vid text; v_pos int := 0;
begin
  -- leere Meldung = Datenlücke → keine Schlüsse
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

  -- Konfidenz: Basis 0,5; andere Erfassungsstation +0,15 (gleiche Station eher Datenfehler −0,15);
  -- ganze 4-Wagen-Einheiten +0,15; gemischter Austausch −0,2; begrenzt auf 0,1–0,9
  v_conf := 0.5
    + case when v_prev.station_id is distinct from new.station_id then 0.15 else -0.15 end
    + case when v_kind in ('possible_split','possible_join') and (cardinality(v_missing) + cardinality(v_new)) % 4 = 0 then 0.15 else 0 end
    - case when v_kind = 'composition_change' then 0.2 else 0 end;
  v_conf := least(0.9, greatest(0.1, v_conf));

  insert into public.split_events (trip_id, prev_formation_id, curr_formation_id, station_id, station_name, missing_vehicles, new_vehicles, order_changed, kind, confidence)
  values (new.trip_id, v_prev.id, new.id, new.station_id, new.station_name, v_missing, v_new, v_order, v_kind, v_conf)
  on conflict do nothing;
  return new;
end $$;

create trigger formations_after_insert after insert on public.formations
for each row execute function private.on_formation_insert();

-- Abstellort-/Status-Schätzung (nur Vermutungen, mit Konfidenz)
create or replace function private.update_parking_estimates() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with last as (
    select distinct on (s.vehicle_id) s.vehicle_id, s.observed_at, s.trip_id
    from public.vehicle_sightings s order by s.vehicle_id, s.observed_at desc
  ), info as (
    select l.vehicle_id, l.observed_at, t.last_arr, t.destination_name,
      (select ts.station_id from public.trip_stops ts where ts.trip_id = t.id order by ts.seq desc limit 1) as dest_station_id,
      extract(epoch from (now() - coalesce(t.last_arr, l.observed_at))) / 60 as min_since_end
    from last l left join public.trips t on t.id = l.trip_id
  )
  insert into public.parking_estimates as p (vehicle_id, station_id, station_name, status, confidence, last_sighting_at, reason, estimated_at)
  select vehicle_id, dest_station_id, destination_name,
    case
      when last_arr is not null and last_arr > now() then 'in_service'
      when min_since_end < 60 then 'last_known'
      when min_since_end < 12 * 60 and destination_name ilike 'Plochingen%' then 'maintenance_possible'
      when min_since_end < 12 * 60 then 'parked_assumed'
      else 'unknown' end,
    case
      when last_arr is not null and last_arr > now() then 0.8
      when min_since_end < 60 then 0.4
      when min_since_end < 12 * 60 and destination_name ilike 'Plochingen%' then 0.3
      when min_since_end < 90 then 0.5
      when min_since_end < 12 * 60 then 0.6
      else 0.1 end,
    observed_at,
    case
      when last_arr is not null and last_arr > now() then 'Fahrt laut Fahrplan/Echtzeit noch nicht beendet'
      when min_since_end < 60 then 'Fahrt vor weniger als 60 min beendet – Folgefahrt möglich, noch nicht erfasst'
      when min_since_end < 12 * 60 then format('Seit %s min keine neue Sichtung nach Ankunft in %s', round(min_since_end), coalesce(destination_name, '?'))
      else 'Letzte Sichtung zu alt für eine belastbare Aussage' end,
    now()
  from info
  on conflict (vehicle_id) do update set station_id = excluded.station_id, station_name = excluded.station_name, status = excluded.status,
    confidence = excluded.confidence, last_sighting_at = excluded.last_sighting_at, reason = excluded.reason, estimated_at = now();
  get diagnostics n = row_count;

  update public.vehicles v set status = p.status from public.parking_estimates p where p.vehicle_id = v.id and v.status <> p.status;
  return n;
end $$;

select cron.schedule('parking-estimates', '*/15 * * * *', $$select private.update_parking_estimates()$$);
