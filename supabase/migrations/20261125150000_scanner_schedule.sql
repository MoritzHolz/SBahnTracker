-- Zeitplan für den Webscanner: schaltet ihn zu festen Uhrzeiten (Europe/Berlin) ein und wieder aus. Standard: aus.
-- Ausgeschaltet wird nur, was der Zeitplan selbst eingeschaltet hat; der Schalter von Hand hat Vorrang.
alter table public.scanner_config
  add column schedule_enabled boolean not null default false,
  add column schedule jsonb not null default '[]'::jsonb,
  add column schedule_keep_awake boolean not null default true,
  -- vom Zeitplan eingeschaltet
  add column schedule_on boolean not null default false,
  -- Beginn des zuletzt ausgeführten Zeitfensters: je Fenster wird nur einmal eingeschaltet
  add column schedule_last_start timestamptz;

create or replace function private.scanner_windows(p_windows jsonb, p_now timestamptz)
returns table (start_at timestamptz, end_at timestamptz)
language sql stable set search_path = '' as $$
  select (d.day + w.f) at time zone 'Europe/Berlin',
         (d.day + w.t + case when w.t <= w.f then interval '1 day' else interval '0' end) at time zone 'Europe/Berlin'
  from (select (e->>'from')::time as f, (e->>'to')::time as t from jsonb_array_elements(p_windows) e) w,
       (select (p_now at time zone 'Europe/Berlin')::date + g as day from generate_series(-1, 1) g) d;
$$;

create or replace function private.scanner_apply_schedule(p_now timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.scanner_config%rowtype; v_start timestamptz;
begin
  select * into c from public.scanner_config;
  if not (c.schedule_enabled or c.schedule_on) then return; end if;
  select * into c from public.scanner_config for update;
  if c.schedule_enabled then
    select w.start_at into v_start from private.scanner_windows(c.schedule, p_now) w where w.start_at <= p_now and p_now < w.end_at limit 1;
  end if;
  if v_start is not null and v_start is distinct from c.schedule_last_start then
    update public.scanner_config set schedule_last_start = v_start where true;
    if not c.enabled then
      update public.scanner_config set enabled = true, schedule_on = true, enabled_changed_at = now() where true;
      update public.scanner_state set next_scan_at = now(), consecutive_errors = 0, last_error = null, last_error_at = null where true;
    end if;
  elsif v_start is null and c.schedule_on then
    -- ein laufender Scan darf zu Ende laufen
    update public.scanner_config set enabled = false, schedule_on = false, enabled_changed_at = now() where true;
    update public.scanner_state set next_scan_at = null where true;
  end if;
end $$;
revoke all on function private.scanner_windows(jsonb, timestamptz) from public;
revoke all on function private.scanner_apply_schedule(timestamptz) from public;

create or replace function public.scanner_schedule(p_enabled boolean, p_windows jsonb, p_keep_awake boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_n int;
begin
  if not public.is_member() then
    return jsonb_build_object('ok', false, 'error', 'Nicht berechtigt. Bitte neu anmelden.');
  end if;
  if p_enabled is null or p_keep_awake is null or p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 6 then
    return jsonb_build_object('ok', false, 'error', 'Ungültiger Zeitplan (höchstens 6 Zeitfenster).');
  end if;
  if exists (select 1 from jsonb_array_elements(p_windows) e
             where coalesce(e->>'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(e->>'to', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    return jsonb_build_object('ok', false, 'error', 'Uhrzeiten bitte als HH:MM angeben.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_windows) e where e->>'from' = e->>'to') then
    return jsonb_build_object('ok', false, 'error', 'Beginn und Ende müssen verschieden sein.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('from', e->>'from', 'to', e->>'to') order by e->>'from'), '[]'::jsonb) into v
    from jsonb_array_elements(p_windows) e;
  v_n := jsonb_array_length(v);
  if p_enabled and v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'Bitte mindestens ein Zeitfenster angeben.');
  end if;
  if exists (
    with m as (select i, extract(epoch from (e->>'from')::time) as f,
                 extract(epoch from (e->>'to')::time) + case when e->>'to' <= e->>'from' then 86400 else 0 end as t
               from jsonb_array_elements(v) with ordinality x(e, i))
    select 1 from m a join m b on a.i < b.i, (values (-86400), (0), (86400)) k(s) where a.f < b.t + k.s and b.f + k.s < a.t
  ) then
    return jsonb_build_object('ok', false, 'error', 'Die Zeitfenster überschneiden sich.');
  end if;
  update public.scanner_config set schedule = v, schedule_keep_awake = p_keep_awake, schedule_enabled = p_enabled,
    schedule_last_start = case when p_enabled and not schedule_enabled then null else schedule_last_start end where true;
  perform private.scanner_apply_schedule();
  return jsonb_build_object('ok', true, 'status', private.scanner_status());
end $$;
revoke all on function public.scanner_schedule(boolean, jsonb, boolean) from public, anon;
grant execute on function public.scanner_schedule(boolean, jsonb, boolean) to authenticated, service_role;


-- Status um den Zeitplan ergänzt
create or replace function private.scanner_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'now', now(),
    'enabled', c.enabled,
    'enabled_changed_at', c.enabled_changed_at,
    'interval_min', c.interval_min,
    'formations_enabled', c.formations_enabled,
    'schedule', jsonb_build_object(
      'enabled', c.schedule_enabled, 'windows', c.schedule, 'keep_awake', c.schedule_keep_awake, 'on', c.schedule_on,
      'window_end', (select min(w.end_at) from private.scanner_windows(c.schedule, now()) w where c.schedule_enabled and w.start_at <= now() and now() < w.end_at),
      'next_start', (select min(w.start_at) from private.scanner_windows(c.schedule, now()) w where c.schedule_enabled and w.start_at > now())),
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

-- Der Worker wendet den Zeitplan bei jeder Abfrage an (alle 5 s)
create or replace function public.scanner_worker_poll(p_secret text, p_worker_id text, p_run_id bigint default null, p_step text default null, p_url text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.scanner_config%rowtype; s public.scanner_state%rowtype; v_due text; v_last timestamptz;
begin
  if not private.scanner_key_ok('scanner_worker_hash', p_secret) then raise exception 'unauthorized'; end if;
  -- vor der Sperre auf scanner_state: Reihenfolge überall Konfiguration, dann Zustand
  perform private.scanner_apply_schedule();
  select * into s from public.scanner_state for update;
  if s.worker_id is distinct from p_worker_id and s.heartbeat_at > now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'error', 'other_worker');
  end if;
  update public.scan_runs set status = 'aborted', finished_at = now(), error = 'Worker wurde unterbrochen'
    where status = 'running' and id is distinct from p_run_id;
  update public.scanner_state set worker_id = p_worker_id, heartbeat_at = now(), step = p_step, current_url = p_url where true;
  select * into c from public.scanner_config;
  select max(started_at) into v_last from public.scan_runs;
  if p_run_id is null and (v_last is null or v_last < now() - interval '60 seconds') then
    if c.manual_requested_at > now() - interval '5 minutes' then v_due := 'manual';
    elsif c.enabled and coalesce(s.next_scan_at, now()) <= now() then v_due := 'interval';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'enabled', c.enabled, 'interval_min', c.interval_min,
    'formations_enabled', c.formations_enabled, 'pages', case when v_due is not null then c.pages end, 'due', v_due,
    'keep_awake_until', case when c.schedule_on and c.schedule_keep_awake then
      (select max(w.end_at) from private.scanner_windows(c.schedule, now()) w where w.start_at <= now() and now() < w.end_at) end,
    'abort', p_run_id is not null and not exists (select 1 from public.scan_runs where id = p_run_id and status = 'running'));
end $$;

-- Schalter von Hand: danach gehört der Zustand nicht mehr dem Zeitplan
create or replace function public.scanner_control(p_key text, p_action text, p_value integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member() and not private.scanner_key_ok('scanner_control_hash', p_key) then
    return jsonb_build_object('ok', false, 'error', 'Nicht berechtigt. Bitte neu anmelden.');
  end if;

  if p_action = 'check' then
    null;
  elsif p_action = 'enable' then
    update public.scanner_config set enabled = true, schedule_on = false, enabled_changed_at = now() where not enabled;
    if found then
      update public.scanner_state set next_scan_at = now(), consecutive_errors = 0, last_error = null, last_error_at = null where true;
    end if;
  elsif p_action = 'disable' then
    update public.scanner_config set enabled = false, schedule_on = false, enabled_changed_at = now(), manual_requested_at = null where true;
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
  return jsonb_build_object('ok', true, 'status', private.scanner_status());
end $$;
