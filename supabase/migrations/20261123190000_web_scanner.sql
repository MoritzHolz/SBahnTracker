-- Live-Webscanner: Steuerung, Status, erfasste Züge.
-- Grundsätze:
--   * Der Schalter wird in der Datenbank erzwungen. AUS setzt einen laufenden Scan sofort auf 'aborted';
--     danach nimmt kein scanner_worker_*-Aufruf mehr Daten an (auch nicht von einem hängenden Worker).
--   * Der Worker hat keinen service_role-Key, nur ein eigenes Secret für genau diese Funktionen.
--   * Fehlende Angaben bleiben NULL und stehen in "missing". Es wird nichts ergänzt.

-- ===== Tabellen =====

create table public.scanner_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  interval_min int not null default 10 check (interval_min between 5 and 60),
  formations_enabled boolean not null default true,
  pages jsonb not null,
  enabled_changed_at timestamptz,
  manual_requested_at timestamptz
);

create table public.scan_runs (
  id bigserial primary key,
  trigger text not null check (trigger in ('interval','manual')),
  worker_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','partial','error','aborted')),
  trains_captured int not null default 0,
  trains_new int not null default 0,
  trains_updated int not null default 0,
  formations_found int not null default 0,
  error text
);
create index scan_runs_started_idx on public.scan_runs (started_at desc);

create table public.scanner_state (
  id boolean primary key default true check (id),
  worker_id text,
  heartbeat_at timestamptz,
  step text,
  current_url text,
  next_scan_at timestamptz,
  last_success_at timestamptz,
  last_run_id bigint references public.scan_runs(id) on delete set null,
  last_error text,
  last_error_at timestamptz,
  consecutive_errors int not null default 0
);

-- Ein Datensatz je Zug und Betriebstag (wird aktualisiert, nie doppelt angelegt)
create table public.web_trains (
  id bigserial primary key,
  service_date date not null,
  train_number text not null,
  line_id text references public.lines(id),
  origin_name text,
  destination_name text,
  direction text,
  board_station_id text not null,
  board_station_name text not null,
  arr_planned timestamptz,
  dep_planned timestamptz,
  delay_min int,                       -- NULL = auf der Seite keine Echtzeit angegeben
  platform text,
  cancelled boolean not null default false,
  message text,
  route text[] not null default '{}',
  vehicles text[],                     -- NULL = nicht verfügbar
  vehicle_state text not null default 'not_checked' check (vehicle_state in ('not_checked','available','not_available')),
  vehicle_checked_at timestamptz,
  vehicle_attempts int not null default 0,
  trip_id text references public.trips(id) on delete set null,
  position_kind text not null default 'none' check (position_kind in ('none','estimated')),
  source text not null,
  source_url text not null,
  quality text not null check (quality in ('complete','partial','minimal')),
  missing text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  last_run_id bigint references public.scan_runs(id) on delete set null,
  unique (service_date, train_number)
);
create index web_trains_seen_idx on public.web_trains (last_seen_at desc);
create index web_trains_number_idx on public.web_trains (train_number);
create index web_trains_trip_idx on public.web_trains (trip_id);

-- Verlauf: nur bei Änderung eine neue Zeile (hält die Free-Tier-Datenbank klein)
create table public.web_observations (
  id bigserial primary key,
  web_train_id bigint not null references public.web_trains(id) on delete cascade,
  run_id bigint references public.scan_runs(id) on delete set null,
  observed_at timestamptz not null default now(),
  source text not null,
  source_url text not null,
  train_number text not null,
  line_id text,
  vehicles text[],
  origin_name text,
  destination_name text,
  arr_planned timestamptz,
  dep_planned timestamptz,
  delay_min int,
  platform text,
  cancelled boolean not null,
  quality text not null,
  missing text[] not null default '{}'
);
create index web_observations_train_idx on public.web_observations (web_train_id, observed_at desc);

-- Stationsnamen der Webseite → eigene Stations-ID. Wird nur aus eindeutig zugeordneten Fahrten gelernt.
create table public.station_aliases (
  name text not null,
  station_id text not null,
  hits int not null default 1,
  primary key (name, station_id)
);

do $$
declare t text;
begin
  foreach t in array array['scanner_config','scanner_state','scan_runs','web_trains','web_observations','station_aliases'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  -- nur die erfassten Züge sind direkt lesbar; Steuerung/Status laufen über RPC
  foreach t in array array['web_trains','web_observations'] loop
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

insert into public.scanner_config (pages) values ('[
  {"id":"dbf_hbf_tief","kind":"board","label":"DBF – Stuttgart Hbf (tief)","url":"https://dbf.finalrewind.org/Stuttgart%20Hbf%20(tief)?past=1","station_id":"de:08111:6118","station_name":"Stuttgart Hbf (tief)"},
  {"id":"dbf_feuerbach","kind":"board","label":"DBF – Stuttgart-Feuerbach (S62)","url":"https://dbf.finalrewind.org/Stuttgart-Feuerbach?past=1","station_id":"de:08111:6157","station_name":"Stuttgart-Feuerbach","only_lines":["S62"]},
  {"id":"bahnexpert_hbf_tief","kind":"formation","label":"bahn.expert – Stuttgart Hbf (tief)","url":"https://bahn.expert/Stuttgart%20Hbf%20(tief)","station_id":"de:08111:6118","station_name":"Stuttgart Hbf (tief)"}
]'::jsonb);
insert into public.scanner_state default values;

-- ===== Authentifizierung =====
-- private.app_config: 'scanner_control_hash' und 'scanner_worker_hash' = SHA-256 (hex) langer Zufallsschlüssel.
-- Erzeugen: npm run scanner:keys

create or replace function private.scanner_key_ok(p_name text, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_key, '') <> '' and exists (
    select 1 from private.app_config
    where key = p_name and value = encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex'));
$$;

-- ===== Öffentlicher Status =====

create or replace function public.scanner_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'now', now(),
    'enabled', c.enabled,
    'enabled_changed_at', c.enabled_changed_at,
    'interval_min', c.interval_min,
    'formations_enabled', c.formations_enabled,
    'manual_pending', c.manual_requested_at is not null and c.manual_requested_at > now() - interval '5 minutes',
    'worker_online', coalesce(s.heartbeat_at > now() - interval '30 seconds', false),
    'heartbeat_at', s.heartbeat_at,
    'scan_state', case
        when exists (select 1 from public.scan_runs r where r.status = 'running') and coalesce(s.heartbeat_at > now() - interval '60 seconds', false) then 'running'
        when not c.enabled then 'off'
        when not coalesce(s.heartbeat_at > now() - interval '30 seconds', false) then 'error'
        when s.consecutive_errors > 0 then 'error'
        else 'waiting' end,
    'step', s.step,
    'current_url', s.current_url,
    'next_scan_at', case when c.enabled then s.next_scan_at end,
    'last_success_at', s.last_success_at,
    'last_error', s.last_error,
    'last_error_at', s.last_error_at,
    'consecutive_errors', s.consecutive_errors,
    'last_run', (select to_jsonb(r) - 'worker_id' from public.scan_runs r where r.id = s.last_run_id),
    'recent_runs', (select coalesce(jsonb_agg(to_jsonb(r) - 'worker_id' order by r.id desc), '[]'::jsonb)
                    from (select * from public.scan_runs order by id desc limit 12) r),
    'pages', (select jsonb_agg(jsonb_build_object('label', p->>'label', 'url', p->>'url', 'kind', p->>'kind')) from jsonb_array_elements(c.pages) p)
  )
  from public.scanner_config c, public.scanner_state s;
$$;

-- ===== Steuerung (Schalter) =====

create or replace function public.scanner_control(p_key text, p_action text, p_value int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.scanner_key_ok('scanner_control_hash', p_key) then
    return jsonb_build_object('ok', false, 'error', 'Steuerschlüssel falsch.');
  end if;

  if p_action = 'check' then
    null;
  elsif p_action = 'enable' then
    update public.scanner_config set enabled = true, enabled_changed_at = now() where not enabled;
    if found then
      update public.scanner_state set next_scan_at = now(), consecutive_errors = 0, last_error = null, last_error_at = null where true;
    end if;
  elsif p_action = 'disable' then
    update public.scanner_config set enabled = false, enabled_changed_at = now(), manual_requested_at = null where true;
    update public.scan_runs set status = 'aborted', finished_at = now(), error = 'Durch Ausschalten beendet' where status = 'running';
    update public.scanner_state set next_scan_at = null where true;
  elsif p_action = 'scan_now' then
    update public.scanner_config set manual_requested_at = now() where true;
  elsif p_action = 'set_interval' then
    if p_value is null or p_value < 5 or p_value > 60 then
      return jsonb_build_object('ok', false, 'error', 'Intervall muss zwischen 5 und 60 Minuten liegen.');
    end if;
    update public.scanner_config set interval_min = p_value where true;
    update public.scanner_state s set next_scan_at = greatest(now(),
        coalesce((select max(r.started_at) from public.scan_runs r), now()) + make_interval(mins => p_value))
      where exists (select 1 from public.scanner_config c where c.enabled);
  elsif p_action = 'set_formations' then
    update public.scanner_config set formations_enabled = coalesce(p_value, 0) <> 0 where true;
  else
    return jsonb_build_object('ok', false, 'error', 'Unbekannte Aktion.');
  end if;
  return jsonb_build_object('ok', true, 'status', public.scanner_status());
end $$;

-- ===== Worker-Schnittstelle (nur mit Worker-Secret) =====

-- Herzschlag; liefert die aktuelle Anweisung. "abort" heißt: laufender Scan ist nicht (mehr) erlaubt.
create or replace function public.scanner_worker_poll(p_secret text, p_worker_id text, p_run_id bigint default null,
  p_step text default null, p_url text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.scanner_config%rowtype; s public.scanner_state%rowtype; v_due text; v_last timestamptz;
begin
  if not private.scanner_key_ok('scanner_worker_hash', p_secret) then raise exception 'unauthorized'; end if;
  select * into s from public.scanner_state for update;
  if s.worker_id is distinct from p_worker_id and s.heartbeat_at > now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'error', 'other_worker');
  end if;
  -- verwaiste Läufe (Worker abgestürzt oder neu gestartet)
  update public.scan_runs set status = 'aborted', finished_at = now(), error = 'Worker wurde unterbrochen'
    where status = 'running' and id is distinct from p_run_id;
  update public.scanner_state set worker_id = p_worker_id, heartbeat_at = now(), step = p_step, current_url = p_url where true;
  select * into c from public.scanner_config;
  select max(started_at) into v_last from public.scan_runs;
  -- mind. 60 s Abstand: die Quelle erlaubt höchstens eine Abfrage je Station und Minute
  if p_run_id is null and (v_last is null or v_last < now() - interval '60 seconds') then
    if c.manual_requested_at > now() - interval '5 minutes' then v_due := 'manual';
    elsif c.enabled and coalesce(s.next_scan_at, now()) <= now() then v_due := 'interval';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'enabled', c.enabled, 'interval_min', c.interval_min,
    'formations_enabled', c.formations_enabled, 'pages', case when v_due is not null then c.pages end, 'due', v_due,
    'abort', p_run_id is not null and not exists (select 1 from public.scan_runs where id = p_run_id and status = 'running'));
end $$;

create or replace function public.scanner_worker_start(p_secret text, p_worker_id text, p_trigger text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare c public.scanner_config%rowtype; v_id bigint;
begin
  if not private.scanner_key_ok('scanner_worker_hash', p_secret) then raise exception 'unauthorized'; end if;
  select * into c from public.scanner_config for update;
  if p_trigger = 'manual' then
    if c.manual_requested_at is null then return null; end if;
    update public.scanner_config set manual_requested_at = null where true;
  elsif not c.enabled then
    return null;
  end if;
  if exists (select 1 from public.scan_runs where status = 'running') then return null; end if;
  insert into public.scan_runs (trigger, worker_id) values (p_trigger, p_worker_id) returning id into v_id;
  update public.scanner_state set next_scan_at = case when c.enabled then now() + make_interval(mins => c.interval_min) end where true;
  return v_id;
end $$;

-- Sperrt den Lauf gegen gleichzeitiges Ausschalten und prüft, ob er noch erlaubt ist.
create or replace function private.scanner_require_run(p_secret text, p_run_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not private.scanner_key_ok('scanner_worker_hash', p_secret) then raise exception 'unauthorized'; end if;
  perform 1 from public.scan_runs where id = p_run_id and status = 'running' for update;
  return found;
end $$;

create or replace function private.web_quality(p_missing text[]) returns text
language sql immutable set search_path = '' as $$
  select case when cardinality(p_missing) = 0 then 'complete'
              when p_missing && array['line','origin','destination','time'] then 'minimal'
              else 'partial' end;
$$;

create or replace function private.alias_station(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select a.station_id from public.station_aliases a
  where a.name = p_name and a.hits >= 2
    and a.hits >= 4 * coalesce((select max(b.hits) from public.station_aliases b where b.name = p_name and b.station_id <> a.station_id), 0)
  order by a.hits desc limit 1;
$$;

-- Fahrt für einen Zug anlegen, den der Fahrplanabruf (EFA) nicht kennt.
-- Nur wenn eine bekannte Fahrt derselben Linie mit exakt gleicher Haltfolge existiert; deren Fahrzeiten
-- werden auf die abgelesene Uhrzeit verschoben. Ergebnis ist immer eine Schätzung.
create or replace function private.web_build_trip(p_train text, p_line text, p_board_id text, p_board_planned timestamptz,
  p_delay int, p_platform text, p_route text[], p_origin text, p_dest text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_ids text[]; v_tpl public.trips%rowtype; v_board record; v_off interval; v_id text; v_date date; v_delay interval;
begin
  if cardinality(p_route) < 2 or p_train !~ '^\d{1,9}$' then return null; end if;
  select array_agg(private.alias_station(n) order by i) into v_ids from unnest(p_route) with ordinality u(n, i);
  if array_position(v_ids, null) is not null then return null; end if;
  select t.* into v_tpl from public.trips t
  where t.source = 'efa_nvbw' and t.line_id = p_line and not t.cancelled and t.stop_count = cardinality(v_ids)
    and t.service_date >= current_date - 14
    and (select array_agg(s.station_id order by s.seq) from public.trip_stops s where s.trip_id = t.id and s.seq < t.stop_count) = v_ids
  order by t.first_dep desc limit 1;
  if not found then return null; end if;
  select seq, coalesce(dep_planned, arr_planned) as planned into v_board
    from public.trip_stops where trip_id = v_tpl.id and station_id = p_board_id and seq < v_tpl.stop_count limit 1;
  if not found or v_board.planned is null then return null; end if;
  v_off := p_board_planned - v_board.planned;
  v_delay := make_interval(mins => p_delay);  -- NULL bleibt NULL
  v_date := ((v_tpl.first_dep + v_off) at time zone 'Europe/Berlin')::date;
  v_id := v_date || '|web|' || p_train;

  insert into public.trips as tr (id, service_date, line_id, transport_id, trip_code, train_number, origin_name, destination_name,
    direction, shape_id, first_dep, last_arr, has_realtime, cancelled, source, updated_at, stop_count)
  select v_id, v_date, p_line, 'web:' || p_line, p_train::int, p_train, p_origin, p_dest, v_tpl.direction, v_tpl.shape_id,
    min(coalesce(dep_planned, arr_planned)) + v_off, max(coalesce(arr_planned, dep_planned)) + v_off + coalesce(v_delay, interval '0'),
    p_delay is not null, false, 'web_dbf', now(), v_tpl.stop_count
  from public.trip_stops where trip_id = v_tpl.id and seq < v_tpl.stop_count
  on conflict (id) do update set last_arr = excluded.last_arr, has_realtime = excluded.has_realtime, updated_at = now();

  insert into public.trip_stops as ts (trip_id, seq, station_id, station_name, lat, lon, platform, arr_planned, dep_planned, arr_est, dep_est)
  select v_id, seq, station_id, station_name, lat, lon, case when seq = v_board.seq then p_platform end,
    arr_planned + v_off, dep_planned + v_off,
    case when seq >= v_board.seq then arr_planned + v_off + v_delay end,
    case when seq >= v_board.seq then dep_planned + v_off + v_delay end
  from public.trip_stops where trip_id = v_tpl.id and seq < v_tpl.stop_count
  on conflict (trip_id, seq) do update set platform = excluded.platform, arr_est = excluded.arr_est, dep_est = excluded.dep_est;
  return v_id;
end $$;

-- Passende Fahrt zu Zugnummer + abgelesener Planzeit
create or replace function private.web_match_trip(p_train text, p_line text, p_planned timestamptz) returns public.trips
language sql stable security definer set search_path = '' as $$
  select t from public.trips t
  where t.train_number = p_train
    and (p_line is null or t.line_id is null or t.line_id = p_line)
    and t.first_dep <= p_planned + interval '20 minutes'
    and coalesce(t.last_arr, t.first_dep) >= p_planned - interval '20 minutes'
  order by (t.source = 'efa_nvbw') desc, abs(extract(epoch from t.first_dep - p_planned)) limit 1;
$$;

create or replace function public.scanner_worker_ingest(p_secret text, p_run_id bigint, p_page jsonb, p_records jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; v_old public.web_trains%rowtype; v_trip public.trips; v_trip_id text; v_line text; v_planned timestamptz; v_date date;
  v_route text[]; v_missing text[]; v_vehicles text[]; v_id bigint; v_changed boolean;
  n_cap int := 0; n_new int := 0; n_upd int := 0; n_skip int := 0;
begin
  if not private.scanner_require_run(p_secret, p_run_id) then return jsonb_build_object('ok', false, 'error', 'aborted'); end if;
  if jsonb_array_length(p_records) > 500 then raise exception 'too many records'; end if;

  for r in select * from jsonb_array_elements(p_records) loop
    begin
      v_planned := coalesce((r->>'dep_planned')::timestamptz, (r->>'arr_planned')::timestamptz);
      if coalesce(r->>'train_number', '') = '' or v_planned is null or abs(extract(epoch from v_planned - now())) > 43200 then
        n_skip := n_skip + 1; continue;
      end if;
      v_line := (select l.id from public.lines l where l.id = r->>'line');
      v_route := coalesce((select array_agg(x) from jsonb_array_elements_text(r->'route') x), '{}');
      v_trip := null; v_trip_id := null; v_old := null;
      select (m).* into v_trip from private.web_match_trip(r->>'train_number', v_line, v_planned) m;

      if v_trip.id is not null and v_trip.source = 'efa_nvbw' then
        v_trip_id := v_trip.id;
        -- Stationsnamen lernen: nur bei gleich langer Haltfolge
        if not coalesce((r->>'cancelled')::boolean, false) and cardinality(v_route) = v_trip.stop_count then
          insert into public.station_aliases as a (name, station_id)
          select distinct on (u.n, s.station_id) u.n, s.station_id from unnest(v_route) with ordinality u(n, i)
            join public.trip_stops s on s.trip_id = v_trip.id and s.seq = u.i - 1
          on conflict (name, station_id) do update set hits = a.hits + 1 where a.hits < 50;
        end if;
      elsif not coalesce((r->>'cancelled')::boolean, false) and v_line is not null then
        v_trip_id := private.web_build_trip(r->>'train_number', v_line, p_page->>'station_id', v_planned,
          (r->>'delay_min')::int, r->>'platform', v_route, r->>'origin', r->>'destination');
      end if;

      select * into v_old from public.web_trains w
        where w.train_number = r->>'train_number'
          and abs(extract(epoch from coalesce(w.dep_planned, w.arr_planned) - v_planned)) < 21600
        order by w.last_seen_at desc limit 1 for update;

      v_date := coalesce(v_old.service_date, v_trip.service_date,
        (select t.service_date from public.trips t where t.id = v_trip_id), (v_planned at time zone 'Europe/Berlin')::date);
      v_vehicles := v_old.vehicles;
      v_missing := array_remove(array[
        case when v_line is null then 'line' end,
        case when r->>'origin' is null then 'origin' end,
        case when r->>'destination' is null then 'destination' end,
        case when r->>'delay_min' is null then 'delay' end,
        case when r->>'platform' is null then 'platform' end,
        case when v_vehicles is null then 'vehicles' end], null);

      if v_old.id is null then
        insert into public.web_trains (service_date, train_number, line_id, origin_name, destination_name, direction, board_station_id, board_station_name,
          arr_planned, dep_planned, delay_min, platform, cancelled, message, route, trip_id, position_kind, source, source_url, quality, missing, last_run_id)
        values (v_date, r->>'train_number', v_line, r->>'origin', r->>'destination', v_trip.direction, p_page->>'station_id', p_page->>'station_name',
          (r->>'arr_planned')::timestamptz, (r->>'dep_planned')::timestamptz, (r->>'delay_min')::int, r->>'platform',
          coalesce((r->>'cancelled')::boolean, false), left(r->>'message', 300), v_route, v_trip_id,
          case when v_trip_id is null then 'none' else 'estimated' end, p_page->>'source', p_page->>'url', private.web_quality(v_missing), v_missing, p_run_id)
        returning id into v_id;
        n_new := n_new + 1; v_changed := true;
      else
        v_id := v_old.id;
        v_changed := (v_old.delay_min, v_old.platform, v_old.cancelled, v_old.destination_name, v_old.dep_planned, v_old.arr_planned)
          is distinct from ((r->>'delay_min')::int, r->>'platform', coalesce((r->>'cancelled')::boolean, false), r->>'destination',
            (r->>'dep_planned')::timestamptz, (r->>'arr_planned')::timestamptz);
        -- Ersatzfahrt wurde inzwischen vom Fahrplanabruf geliefert → Fahrzeugdaten umhängen
        if v_old.trip_id is not null and v_trip_id is not null and v_old.trip_id <> v_trip_id and v_old.trip_id like '%|web|%' then
          update public.formations set trip_id = v_trip_id where trip_id = v_old.trip_id;
          update public.vehicle_sightings set trip_id = v_trip_id where trip_id = v_old.trip_id;
          update public.split_events set trip_id = v_trip_id where trip_id = v_old.trip_id;
          update public.vehicles set last_trip_id = v_trip_id where last_trip_id = v_old.trip_id;
        end if;
        update public.web_trains set line_id = coalesce(v_line, line_id), origin_name = coalesce(r->>'origin', origin_name),
          destination_name = coalesce(r->>'destination', destination_name), direction = coalesce(v_trip.direction, direction),
          arr_planned = (r->>'arr_planned')::timestamptz, dep_planned = (r->>'dep_planned')::timestamptz,
          delay_min = (r->>'delay_min')::int, platform = r->>'platform', cancelled = coalesce((r->>'cancelled')::boolean, false),
          message = left(r->>'message', 300), route = case when cardinality(v_route) > 1 then v_route else route end,
          trip_id = coalesce(v_trip_id, trip_id), position_kind = case when coalesce(v_trip_id, trip_id) is null then 'none' else 'estimated' end,
          board_station_id = p_page->>'station_id', board_station_name = p_page->>'station_name',
          source = p_page->>'source', source_url = p_page->>'url', quality = private.web_quality(v_missing), missing = v_missing,
          last_seen_at = now(), last_run_id = p_run_id, last_changed_at = case when v_changed then now() else last_changed_at end
        where id = v_id;
        n_upd := n_upd + 1;
      end if;

      if v_changed then
        insert into public.web_observations (web_train_id, run_id, source, source_url, train_number, line_id, vehicles, origin_name, destination_name,
          arr_planned, dep_planned, delay_min, platform, cancelled, quality, missing)
        select id, p_run_id, source, source_url, train_number, line_id, vehicles, origin_name, destination_name,
          arr_planned, dep_planned, delay_min, platform, cancelled, quality, missing from public.web_trains where id = v_id;
      end if;
      n_cap := n_cap + 1;
    exception when others then
      n_skip := n_skip + 1;
      raise warning 'scanner_worker_ingest: % übersprungen: %', r->>'train_number', sqlerrm;
    end;
  end loop;

  update public.scan_runs set trains_captured = trains_captured + n_cap, trains_new = trains_new + n_new, trains_updated = trains_updated + n_upd
    where id = p_run_id;
  return jsonb_build_object('ok', true, 'captured', n_cap, 'new', n_new, 'updated', n_upd, 'skipped', n_skip);
end $$;

-- Für welche Züge fehlt die Wagenreihung noch? (je Fahrt höchstens zwei Versuche, danach nicht mehr)
create or replace function public.scanner_worker_formation_targets(p_secret text, p_run_id bigint, p_trains text[], p_limit int default 8) returns text[]
language plpgsql security definer set search_path = '' as $$
begin
  if not private.scanner_require_run(p_secret, p_run_id) then return null; end if;
  return (select coalesce(array_agg(x.train_number), '{}') from (
    select w.train_number from public.web_trains w
    where w.train_number = any(p_trains) and w.trip_id is not null and not w.cancelled
      and w.vehicle_state <> 'available' and w.vehicle_attempts < 2
      and (w.vehicle_checked_at is null or w.vehicle_checked_at < now() - interval '8 minutes')
      and coalesce(w.dep_planned, w.arr_planned) between now() - interval '30 minutes' and now() + interval '25 minutes'
    order by abs(extract(epoch from coalesce(w.dep_planned, w.arr_planned) - now()))
    limit least(greatest(p_limit, 0), 25)) x);
end $$;

-- p_vehicles NULL = Seite zeigt für diesen Zug keine Fahrzeugnummern
create or replace function public.scanner_worker_ingest_formation(p_secret text, p_run_id bigint, p_page jsonb, p_train text,
  p_planned timestamptz, p_vehicles text[], p_groups jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.web_trains%rowtype; v_last text[];
begin
  if not private.scanner_require_run(p_secret, p_run_id) then return jsonb_build_object('ok', false, 'error', 'aborted'); end if;
  select * into w from public.web_trains t
    where t.train_number = p_train and t.trip_id is not null and abs(extract(epoch from coalesce(t.dep_planned, t.arr_planned) - p_planned)) < 900
    order by t.last_seen_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_train'); end if;

  if coalesce(cardinality(p_vehicles), 0) = 0 then
    update public.web_trains set vehicle_state = case when vehicle_state = 'available' then vehicle_state else 'not_available' end,
      vehicle_checked_at = now(), vehicle_attempts = vehicle_attempts + 1 where id = w.id;
    return jsonb_build_object('ok', true, 'stored', false);
  end if;
  if cardinality(p_vehicles) > 4 or exists (select 1 from unnest(p_vehicles) v where v !~ '^\d{3} \d{3}$')
     or (select count(distinct v) from unnest(p_vehicles) v) <> cardinality(p_vehicles) then
    return jsonb_build_object('ok', false, 'error', 'invalid_vehicles');
  end if;

  select f.vehicles into v_last from public.formations f where f.trip_id = w.trip_id and f.source = 'bahn.expert' order by f.observed_at desc limit 1;
  if v_last is distinct from p_vehicles then
    insert into public.formations (trip_id, station_id, station_name, observed_at, vehicles, groups, source)
    values (w.trip_id, p_page->>'station_id', p_page->>'station_name', now(), p_vehicles, p_groups, 'bahn.expert');
  end if;
  update public.web_trains set vehicles = p_vehicles, vehicle_state = 'available', vehicle_checked_at = now(), vehicle_attempts = vehicle_attempts + 1,
    missing = array_remove(missing, 'vehicles'), quality = private.web_quality(array_remove(missing, 'vehicles')), last_changed_at = now() where id = w.id;
  insert into public.web_observations (web_train_id, run_id, source, source_url, train_number, line_id, vehicles, origin_name, destination_name,
    arr_planned, dep_planned, delay_min, platform, cancelled, quality, missing)
  select id, p_run_id, 'bahn.expert', p_page->>'url', train_number, line_id, vehicles, origin_name, destination_name,
    arr_planned, dep_planned, delay_min, platform, cancelled, quality, missing from public.web_trains where id = w.id;
  update public.scan_runs set formations_found = formations_found + 1 where id = p_run_id;
  return jsonb_build_object('ok', true, 'stored', true);
end $$;

create or replace function public.scanner_worker_finish(p_secret text, p_run_id bigint, p_status text, p_error text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_err int; v_int int; v_enabled boolean;
begin
  if not private.scanner_require_run(p_secret, p_run_id) then return false; end if;
  if p_status not in ('ok','partial','error','aborted') then raise exception 'bad status'; end if;
  update public.scan_runs set status = p_status, finished_at = now(), error = left(p_error, 500) where id = p_run_id;
  select enabled, interval_min into v_enabled, v_int from public.scanner_config;
  if p_status in ('ok','partial') then
    update public.scanner_state set last_success_at = now(), last_run_id = p_run_id, consecutive_errors = 0,
      last_error = case when p_error is null then last_error else left(p_error, 500) end,
      last_error_at = case when p_error is null then last_error_at else now() end where true;
  elsif p_status = 'error' then
    update public.scanner_state set last_run_id = p_run_id, consecutive_errors = consecutive_errors + 1, last_error = left(p_error, 500), last_error_at = now()
      where true returning consecutive_errors into v_err;
    -- Nach Fehlern seltener versuchen: doppeltes Intervall je Fehler, höchstens 60 min
    update public.scanner_state set next_scan_at = case when v_enabled then now() + make_interval(mins => least(60, v_int * power(2, least(v_err, 4))::int)) end where true;
  end if;
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array['scanner_status()','scanner_control(text,text,int)','scanner_worker_poll(text,text,bigint,text,text)',
    'scanner_worker_start(text,text,text)','scanner_worker_ingest(text,bigint,jsonb,jsonb)','scanner_worker_formation_targets(text,bigint,text[],int)',
    'scanner_worker_ingest_formation(text,bigint,jsonb,text,timestamptz,text[],jsonb)','scanner_worker_finish(text,bigint,text,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ===== Integration in die Karte =====

-- Wie bisher, zusätzlich "web" (Stand des Webscanners) je Fahrt.
-- Ersatzfahrten (web_dbf) entfallen, sobald der Fahrplanabruf dieselbe Zugnummer liefert → keine doppelten Züge.
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
          from public.formations f where f.trip_id = tr.id order by f.observed_at desc limit 1),
      'web', (select jsonb_build_object('first_seen_at', w.first_seen_at, 'last_seen_at', w.last_seen_at, 'run_id', w.last_run_id,
            'delay_min', w.delay_min, 'platform', w.platform, 'board_station_id', w.board_station_id, 'board_station_name', w.board_station_name, 'cancelled', w.cancelled,
            'message', w.message, 'quality', w.quality, 'missing', w.missing, 'vehicle_state', w.vehicle_state, 'source', w.source)
          from public.web_trains w where w.trip_id = tr.id order by w.last_seen_at desc limit 1)
    ) as t
    from public.trips tr
    where tr.first_dep between p_now - interval '6 hours' and p_now + interval '10 minutes'
      and coalesce(tr.last_arr, tr.first_dep) >= p_now - interval '10 minutes'
      and not (tr.source = 'web_dbf' and exists (select 1 from public.trips o
        where o.source = 'efa_nvbw' and o.service_date = tr.service_date and o.train_number = tr.train_number))
  ) x;
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
      'note', 'Fahrzeugnummern stammen vom Webscanner (bahn.expert, nur wenn eingeschaltet) und aus eigenen Meldungen.')
  );
$$;
