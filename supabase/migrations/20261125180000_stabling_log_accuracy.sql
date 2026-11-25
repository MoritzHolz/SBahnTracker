-- Abstellprotokoll genauer:
-- 1. Schwabstraße: verspätete planmäßige Wenden (laut Plan kürzer als 15 min, Abfahrt am selben Bahnhof) sind keine Abstellung.
-- 2. Abfahrt gilt nur als beobachtet, wenn genug der Abfahrten dazwischen gelesen wurden. Sonst nur "wieder gesehen".
-- 3. Neuer Eintrag nur, wenn in den ersten 2 h der Standzeit mindestens die Hälfte aller Fahrten gelesen wurde.
do $x$
declare d text := pg_get_functiondef('private.update_parking_estimates(timestamptz)'::regprocedure);
  r text[][] := array[
    ['  analyze pg_temp._st;', E'  create index on pg_temp._st (first_dep);\n  analyze pg_temp._st;'],
    ['select s.*, d.rt, d.rr, d.lt, d.lr, d.tt, d.tr,', E'select s.*, d.rt, d.rr, d.lt, d.lr, d.tt, d.tr, o.ot, o.ore,\n    s.is_loop and s.next_id is not null and s.b_from = s.to_id and s.b_dep_planned - s.planned_arr < s.min_stay as plan_turn,'],
    ['  where s.last_arr <= p_now and (s.next_id is null', E'  left join lateral (select count(*) as ot, count(x.vehicles) as ore from pg_temp._st x\n    where x.first_dep between s.last_arr and least(s.end_at, s.last_arr + interval ''2 hours'', p_now - interval ''15 minutes'')) o on true\n  where s.last_arr <= p_now and (s.next_id is null'],
    ['x.end_at - x.last_arr >= x.min_stay' || chr(10) || '    and (exists', 'x.end_at - x.last_arr >= x.min_stay and not x.plan_turn' || chr(10) || '    and (exists'],
    ['0.5 end and (not x.is_loop or x.tr = x.tt)))', '0.5 end and (not x.is_loop or x.tr = x.tt) and (x.ot < 5 or x.ore * 2 >= x.ot)))'],
    ['s.next_id is not null and s.end_at - s.last_arr < s.min_stay and s.ended)', 's.next_id is not null and ((s.end_at - s.last_arr < s.min_stay and s.ended)' || chr(10) || '                or (s.is_loop and s.b_from = s.to_id and s.b_dep_planned - s.planned_arr < s.min_stay)))'],
    ['x.ended and x.b_from = x.to_id then', 'x.ended and x.b_from = x.to_id and x.conf >= 0.5 then']
  ];
begin
  for i in 1 .. array_length(r, 1) loop
    if position(r[i][1] in d) = 0 then raise exception 'Textstelle % nicht gefunden', i; end if;
    d := replace(d, r[i][1], r[i][2]);
  end loop;
  execute d;
end $x$;

-- Rückwirkend: aus den seit 23.11. gesammelten Daten nachträglich aufbauen
update private.app_config set value = '2026-11-23 18:00+01' where key = 'stabling_log_from';
do $x$
declare t timestamptz;
begin
  for t in select generate_series('2026-11-23 18:00+01'::timestamptz, '2026-11-25 14:30+01'::timestamptz, interval '30 minutes') loop
    perform private.update_parking_estimates(t);
  end loop;
  perform private.update_parking_estimates();
end $x$;
