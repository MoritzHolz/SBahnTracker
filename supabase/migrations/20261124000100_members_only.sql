-- Login, Teil 2: Lesen nur noch für angemeldete, freigeschaltete Konten (private.members).
-- Voraussetzung: mindestens ein Eintrag in private.members, sonst kommt niemand mehr an die Daten.
-- Collector (service_role) und Scanner-Worker (eigenes Secret) sind nicht betroffen.

do $$
declare t text;
begin
  if not exists (select 1 from private.members) then
    raise exception 'Kein Konto freigeschaltet (private.members ist leer). Abgebrochen.';
  end if;
  foreach t in array array['trips','lines','stations','route_shapes','trip_stops','vehicle_types','vehicles','formations',
    'vehicle_sightings','split_events','parking_estimates','collector_runs','web_trains','web_observations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_member()))', t || '_read', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon;

-- security-definer-Funktionen umgehen RLS: Original nach private, öffentliche Hülle prüft das Konto
create or replace function public.scanner_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_member() then private.scanner_status() end;
$$;

alter function public.get_source_status() set schema private;
create function public.get_source_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_member() then private.get_source_status() end;
$$;

alter function public.report_formation(text, text, text[], text) set schema private;
create function public.report_formation(p_pin text, p_trip_id text, p_vehicles text[], p_station_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member() then
    return jsonb_build_object('error', 'Nicht angemeldet.');
  end if;
  return private.report_formation(p_pin, p_trip_id, p_vehicles, p_station_id);
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.get_source_status()','private.report_formation(text,text,text[],text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.scanner_status()','public.get_source_status()','public.report_formation(text,text,text[],text)',
    'public.get_live_trips(timestamptz)','public.get_route_shapes()','public.get_route_shapes_by_ids(bigint[])','public.search_vehicle(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
