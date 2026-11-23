import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Lazy-Singleton, damit beim statischen Build kein Client erzeugt wird. Die Anmeldung wird nur im Browser gemerkt. */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase-Konfiguration fehlt (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }
  const browser = typeof window !== "undefined";
  client = createClient(url, key, {
    auth: { persistSession: browser, autoRefreshToken: browser, detectSessionInUrl: false },
  });
  return client;
}
