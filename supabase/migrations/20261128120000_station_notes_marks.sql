-- Standortnotizen je Wochentag und markierte Fahrzeuge. Beides sind reine Benutzerangaben:
-- Sie werden nie als Zugbewegung oder Abstellung gewertet und ändern am Abstellprotokoll nichts.

-- ---------------------------------------------------------------- Notizen (für alle freigeschalteten Konten)
create table public.station_notes (
  id bigint generated always as identity primary key,
  station_id text not null,
  station_name text not null,
  weekday smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Montag … 7 = Sonntag
  time_from time,                                               -- optional; ohne Uhrzeit gilt die Notiz für den ganzen Tag
  time_to time,                                                 -- optional; darf vor time_from liegen (über Mitternacht)
  text text not null check (length(btrim(text)) between 1 and 500),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (time_to is null or time_from is not null)
);
create index station_notes_station_idx on public.station_notes (station_id, weekday);
alter table public.station_notes enable row level security;
revoke all on public.station_notes from anon, authenticated;
grant select, insert, update, delete on public.station_notes to authenticated;
create policy station_notes_read on public.station_notes for select to authenticated using ((select public.is_member()));
create policy station_notes_insert on public.station_notes for insert to authenticated with check ((select public.is_member()) and created_by = (select auth.uid()));
create policy station_notes_update on public.station_notes for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy station_notes_delete on public.station_notes for delete to authenticated using ((select public.is_member()));

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger station_notes_touch before update on public.station_notes for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- Markierte Fahrzeuge (je Konto)
create table public.marked_vehicles (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vehicle_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);
alter table public.marked_vehicles enable row level security;
revoke all on public.marked_vehicles from anon, authenticated;
grant select, insert, delete on public.marked_vehicles to authenticated;
create policy marked_vehicles_own on public.marked_vehicles for all to authenticated
  using ((select public.is_member()) and user_id = (select auth.uid()))
  with check ((select public.is_member()) and user_id = (select auth.uid()));
