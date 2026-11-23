-- Extensions
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Stammdaten
create table public.lines (
  id text primary key,                -- 'S1'
  name text not null,
  color text,                         -- hex, Quelle: Traewelling line-colors (DB Regio S-Bahn Stuttgart)
  text_color text,
  sort int not null default 100
);

create table public.stations (
  id text primary key,                -- EFA/DHID Haltestelle, z. B. de:08111:6118
  name text not null,
  lat double precision not null,
  lon double precision not null,
  updated_at timestamptz not null default now()
);

create table public.route_shapes (
  id bigserial primary key,
  line_id text references public.lines(id),
  signature text not null unique,     -- transport_id|first_stop|last_stop
  coords jsonb not null,              -- [[lon,lat],...]
  stop_ids text[] not null,
  length_m double precision,
  source text not null default 'efa_stopseqcoord',
  fetched_at timestamptz not null default now()
);

create table public.trips (
  id text primary key,                -- service_date|transport_id|trip_code
  service_date date not null,
  line_id text references public.lines(id),
  transport_id text not null,
  trip_code int not null,
  train_number text,
  origin_name text,
  destination_name text,
  direction text,                     -- H / R aus transport_id
  shape_id bigint references public.route_shapes(id),
  first_dep timestamptz,
  last_arr timestamptz,
  has_realtime boolean not null default false,
  cancelled boolean not null default false,
  source text not null default 'efa_nvbw',
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stop_count int                      -- aktuelle Anzahl Halte; ältere Zeilen mit höherem seq werden ignoriert
);
create index trips_time_idx on public.trips (first_dep, last_arr);
create index trips_train_number_idx on public.trips (train_number);

create table public.trip_stops (
  trip_id text not null references public.trips(id) on delete cascade,
  seq int not null,
  station_id text not null,
  station_name text not null,
  platform_id text,
  lat double precision,
  lon double precision,
  platform text,
  planned_platform text,
  arr_planned timestamptz,
  arr_est timestamptz,
  dep_planned timestamptz,
  dep_est timestamptz,
  cancelled boolean not null default false,
  primary key (trip_id, seq)
);
create index trip_stops_station_idx on public.trip_stops (station_id, dep_planned);

-- Fahrzeuge / Wagenreihung (Datenmodell vorbereitet; aktuell keine zulässige freie Quelle angebunden)
create table public.vehicle_types (
  id text primary key,                -- '423', '430'
  name text not null,
  unit_length_m double precision
);

create table public.vehicles (
  id text primary key,                -- '423 502'
  vehicle_type_id text references public.vehicle_types(id),
  first_seen timestamptz,
  last_seen timestamptz,
  last_trip_id text references public.trips(id) on delete set null,
  last_station_id text,
  last_station_name text,
  status text not null default 'unknown'
    check (status in ('in_service','parked_assumed','last_known','maintenance_possible','unknown'))
);

create table public.formations (
  id bigserial primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  station_id text,
  station_name text,
  observed_at timestamptz not null,
  vehicles text[] not null,           -- Reihenfolge wie gemeldet
  groups jsonb,
  source text not null,
  unique (trip_id, station_id, observed_at)
);
create index formations_trip_idx on public.formations (trip_id, observed_at);

create table public.vehicle_sightings (
  id bigserial primary key,
  vehicle_id text not null references public.vehicles(id),
  trip_id text references public.trips(id) on delete set null,
  formation_id bigint references public.formations(id) on delete cascade,
  station_id text,
  station_name text,
  observed_at timestamptz not null,
  position_in_formation int,
  source text not null
);
create index vehicle_sightings_vehicle_idx on public.vehicle_sightings (vehicle_id, observed_at desc);

create table public.split_events (
  id bigserial primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  prev_formation_id bigint not null references public.formations(id) on delete cascade,
  curr_formation_id bigint not null references public.formations(id) on delete cascade,
  station_id text,
  station_name text,
  detected_at timestamptz not null default now(),
  missing_vehicles text[] not null default '{}',
  new_vehicles text[] not null default '{}',
  order_changed boolean not null default false,
  kind text not null check (kind in ('possible_split','possible_join','composition_change','order_change')),
  confidence numeric not null check (confidence between 0 and 1),
  unique (prev_formation_id, curr_formation_id)
);

create table public.parking_estimates (
  vehicle_id text primary key references public.vehicles(id) on delete cascade,
  station_id text,
  station_name text,
  status text not null check (status in ('in_service','parked_assumed','last_known','maintenance_possible','unknown')),
  confidence numeric not null check (confidence between 0 and 1),
  last_sighting_at timestamptz,
  reason text,
  estimated_at timestamptz not null default now()
);

create table public.collector_runs (
  id bigserial primary key,
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  http_status int,
  http_ms int,
  trips_seen int,
  trips_upserted int,
  shapes_fetched int,
  error text
);
create index collector_runs_started_idx on public.collector_runs (source, started_at desc);

-- RLS: öffentlich nur lesen, schreiben nur service_role (Edge Functions / security definer)
do $$
declare t text;
begin
  foreach t in array array['lines','stations','route_shapes','trips','trip_stops','vehicle_types','vehicles','formations','vehicle_sightings','split_events','parking_estimates','collector_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
  end loop;
end $$;

insert into public.vehicle_types (id, name, unit_length_m) values
  ('423', 'DB-Baureihe 423', 67.4),
  ('430', 'DB-Baureihe 430', 68.3);

insert into public.lines (id, name, sort, color, text_color) values
  ('S1','S1',1,'#59af41','#ffffff'),('S2','S2',2,'#ee1c28','#ffffff'),('S3','S3',3,'#f36e31','#ffffff'),
  ('S4','S4',4,'#0166b3','#ffffff'),('S5','S5',5,'#00acdd','#ffffff'),('S6','S6',6,'#844c00','#ffffff'),
  ('S60','S60',7,'#8a8d06','#ffffff'),('S62','S62',8,'#c3792e','#ffffff'),('S11','S11',9,'#59af41','#ffffff');
