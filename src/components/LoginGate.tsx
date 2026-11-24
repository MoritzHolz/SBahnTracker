"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type State = "checking" | "login" | "denied" | "offline" | "member";

/** Abmelden nur auf diesem Gerät. */
export const signOut = () => getSupabase().auth.signOut({ scope: "local" });

/**
 * Zeigt die Seite erst nach Anmeldung mit einem freigeschalteten Konto.
 * Der eigentliche Schutz liegt in der Datenbank (RLS, nur private.members); das hier ist die Oberfläche dazu.
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [userId, setUserId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      if (!session) setState("login");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let off = false;
    const id = window.setTimeout(async () => {
      const { data, error } = await getSupabase().rpc("is_member");
      if (!off) setState(error ? "offline" : data === true ? "member" : "denied");
    }, 0);
    return () => {
      off = true;
      window.clearTimeout(id);
    };
  }, [userId, attempt]);

  if (state === "member") return children;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5 text-fg compact:place-items-start compact:justify-items-center compact:pt-[18dvh]">
      <div className="w-full max-w-xs">
        <h1 className="text-center text-lg font-semibold tracking-tight">S-Bahn Stuttgart Live</h1>
        {state === "checking" && <p className="mt-4 text-center text-[13px] text-faint">Anmeldung wird geprüft …</p>}
        {state === "login" && <LoginForm />}
        {state === "denied" && (
          <Notice text="Dieses Konto ist nicht freigeschaltet." action="Abmelden" onClick={() => void signOut()} />
        )}
        {state === "offline" && (
          <Notice text="Die Anmeldung ließ sich nicht prüfen. Besteht eine Internetverbindung?" action="Erneut versuchen" onClick={() => setAttempt((n) => n + 1)} />
        )}
      </div>
    </main>
  );
}

const BUTTON = "h-10 compact:h-12 compact:text-[15px] w-full rounded-md border border-[var(--line-strong)] bg-white/[0.06] text-[13px] font-medium hover:bg-white/[0.1] disabled:opacity-50";

function Notice({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <div className="mt-4 space-y-3 text-center">
      <p role="alert" className="text-[13px] text-muted">
        {text}
      </p>
      <button className={BUTTON} onClick={onClick}>
        {action}
      </button>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (!error) return;
      setError(
        error.code === "invalid_credentials"
          ? "E-Mail oder Passwort ist falsch."
          : error.status === 429
            ? "Zu viele Versuche. Bitte kurz warten."
            : "Anmeldung nicht möglich. Bitte später erneut versuchen.",
      );
    },
    [email, password],
  );

  const input = "h-10 compact:h-12 w-full rounded-md border border-line bg-black/30 px-3 text-[14px] placeholder:text-faint focus:border-[var(--line-strong)] focus:outline-none";
  return (
    <form onSubmit={submit} className="mt-5 space-y-2.5">
      <input className={input} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" enterKeyHint="next" required autoComplete="username" placeholder="E-Mail" aria-label="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className={input} type="password" enterKeyHint="go" required autoComplete="current-password" placeholder="Passwort" aria-label="Passwort" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className={BUTTON} disabled={busy || !email.trim() || !password}>
        {busy ? "Wird angemeldet …" : "Anmelden"}
      </button>
      {error && (
        <p role="alert" className="text-center text-[12px] text-bad">
          {error}
        </p>
      )}
    </form>
  );
}
