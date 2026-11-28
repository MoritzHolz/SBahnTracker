"use client";

/**
 * Markierte Fahrzeuge und Standortnotizen: dauerhaft in Supabase (Tabellen marked_vehicles, station_notes).
 * Ein gemeinsamer Speicher je Seite, damit alle Ansichten dieselbe Markierung sehen; Änderungen erscheinen sofort
 * (optimistisch) und werden bei Fehlern zurückgenommen.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase";
import type { StationNote } from "@/lib/stablingModel";

type Listener = () => void;
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      for (const l of listeners) l();
    },
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// ------------------------------------------------------------------ Markierungen

const marks = store<{ ids: Set<string>; loaded: boolean; error: string | null }>({ ids: new Set(), loaded: false, error: null });
let marksLoading: Promise<void> | null = null;

async function loadMarks() {
  const { data, error } = await getSupabase().from("marked_vehicles").select("vehicle_id").order("created_at");
  if (error) return marks.set({ ...marks.get(), loaded: true, error: error.message });
  marks.set({ ids: new Set((data ?? []).map((r: { vehicle_id: string }) => r.vehicle_id)), loaded: true, error: null });
}

export interface Marks {
  ids: Set<string>;
  loaded: boolean;
  error: string | null;
  isMarked: (vehicle: string) => boolean;
  /** ein Fahrzeug markieren oder Markierung entfernen */
  toggle: (vehicle: string) => Promise<void>;
  /** irgendein Fahrzeug der Liste markiert */
  anyMarked: (vehicles: string[]) => boolean;
}

export function useMarks(): Marks {
  const s = useSyncExternalStore(marks.subscribe, marks.get, marks.get);
  useEffect(() => {
    marksLoading ??= loadMarks().finally(() => setTimeout(() => (marksLoading = null), 30_000));
  }, []);
  const toggle = useCallback(async (vehicle: string) => {
    const before = marks.get();
    const on = !before.ids.has(vehicle);
    const ids = new Set(before.ids);
    if (on) ids.add(vehicle);
    else ids.delete(vehicle);
    marks.set({ ...before, ids, error: null });
    const t = getSupabase().from("marked_vehicles");
    const { error } = on ? await t.insert({ vehicle_id: vehicle }) : await t.delete().eq("vehicle_id", vehicle);
    if (error && !(on && error.code === "23505")) marks.set({ ...marks.get(), ids: before.ids, error: `Markierung nicht gespeichert: ${error.message}` });
  }, []);
  return {
    ...s,
    isMarked: (v) => s.ids.has(v),
    anyMarked: (vs) => vs.some((v) => s.ids.has(v)),
    toggle,
  };
}

// ------------------------------------------------------------------ Standortnotizen

const notes = store<{ list: StationNote[]; loaded: boolean; error: string | null }>({ list: [], loaded: false, error: null });

async function loadNotes() {
  const { data, error } = await getSupabase()
    .from("station_notes")
    .select("id, station_id, station_name, weekday, time_from, time_to, text, updated_at")
    .order("weekday")
    .order("time_from", { nullsFirst: true });
  if (error) return notes.set({ ...notes.get(), loaded: true, error: error.message });
  const hm = (t: string | null) => (t ? t.slice(0, 5) : null);
  notes.set({ list: (data ?? []).map((n: StationNote) => ({ ...n, time_from: hm(n.time_from), time_to: hm(n.time_to) })), loaded: true, error: null });
}

export type NoteDraft = Pick<StationNote, "station_id" | "station_name" | "weekday" | "time_from" | "time_to" | "text">;

/** Prüft eine Notiz vor dem Speichern; Rückgabe: Fehlermeldung oder null */
export function checkNote(d: NoteDraft): string | null {
  if (!d.station_id) return "Bitte einen Standort wählen.";
  if (!(d.weekday >= 1 && d.weekday <= 7)) return "Bitte einen Wochentag wählen.";
  const text = d.text.trim();
  if (!text) return "Bitte einen Text eingeben.";
  if (text.length > 500) return "Höchstens 500 Zeichen.";
  const ok = (t: string | null) => t == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!ok(d.time_from) || !ok(d.time_to)) return "Uhrzeit bitte als HH:MM angeben.";
  if (d.time_to && !d.time_from) return "Für eine Endzeit bitte auch die Anfangszeit angeben.";
  return null;
}

export interface Notes {
  list: StationNote[];
  loaded: boolean;
  error: string | null;
  /** neue Notiz (id fehlt) oder Änderung; Rückgabe: Fehlermeldung oder null */
  save: (d: NoteDraft & { id?: number }) => Promise<string | null>;
  remove: (id: number) => Promise<string | null>;
  reload: () => Promise<void>;
}

let notesLoading: Promise<void> | null = null;

export function useStationNotes(): Notes {
  const s = useSyncExternalStore(notes.subscribe, notes.get, notes.get);
  useEffect(() => {
    notesLoading ??= loadNotes().finally(() => setTimeout(() => (notesLoading = null), 30_000));
  }, []);
  const save = useCallback(async (d: NoteDraft & { id?: number }) => {
    const problem = checkNote(d);
    if (problem) return problem;
    const row = { station_id: d.station_id, station_name: d.station_name, weekday: d.weekday, time_from: d.time_from || null, time_to: d.time_to || null, text: d.text.trim() };
    const t = getSupabase().from("station_notes");
    const { error } = d.id ? await t.update(row).eq("id", d.id) : await t.insert(row);
    if (error) return `Nicht gespeichert: ${error.message}`;
    await loadNotes();
    return null;
  }, []);
  const remove = useCallback(async (id: number) => {
    const before = notes.get();
    notes.set({ ...before, list: before.list.filter((n) => n.id !== id) });
    const { error } = await getSupabase().from("station_notes").delete().eq("id", id);
    if (error) {
      notes.set(before);
      return `Nicht gelöscht: ${error.message}`;
    }
    return null;
  }, []);
  return { ...s, save, remove, reload: loadNotes };
}
