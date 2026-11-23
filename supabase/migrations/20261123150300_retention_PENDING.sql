-- NOCH NICHT ANGEWENDET (enthält DELETE und braucht deine Freigabe).
-- Hält die Free-Tier-Datenbank (500 MB) dauerhaft klein: ca. 20.000 Halt-Zeilen pro Tag.
-- Anwenden: im Supabase SQL Editor ausführen oder Claude um Freigabe bitten.

create or replace function private.cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Fahrten älter als 30 Tage (Halte werden per FK mitgelöscht); Fahrten mit Wagenreihung bleiben (Fahrzeughistorie)
  delete from public.trips t where t.service_date < current_date - 30
    and not exists (select 1 from public.formations f where f.trip_id = t.id);
  delete from public.collector_runs where started_at < now() - interval '7 days';
  delete from net._http_response where created < now() - interval '1 day';
  delete from cron.job_run_details where end_time < now() - interval '3 days';
end $$;

select cron.schedule('cleanup', '17 3 * * *', $$select private.cleanup()$$);
