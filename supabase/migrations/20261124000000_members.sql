-- Login, Teil 1: freigeschaltete Konten und Scanner-Bedienung für sie. Ändert an bestehenden Zugriffen nichts.
-- Konto freischalten: insert into private.members (user_id) select id from auth.users where email = '<E-MAIL>';

create table if not exists private.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table private.members enable row level security;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.members where user_id = (select auth.uid()));
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated, service_role;

-- Status liegt jetzt in private; die öffentliche Hülle bekommt in Teil 2 die Kontoprüfung
alter function public.scanner_status() set schema private;
revoke all on function private.scanner_status() from public, anon, authenticated;
create function public.scanner_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.scanner_status();
$$;
revoke all on function public.scanner_status() from public;
grant execute on function public.scanner_status() to anon, authenticated, service_role;

create or replace function public.scanner_control(p_key text, p_action text, p_value int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member() and not private.scanner_key_ok('scanner_control_hash', p_key) then
    return jsonb_build_object('ok', false, 'error', 'Nicht berechtigt. Bitte neu anmelden.');
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
  return jsonb_build_object('ok', true, 'status', private.scanner_status());
end $$;
