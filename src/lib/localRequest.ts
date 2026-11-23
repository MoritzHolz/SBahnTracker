const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/i;

/**
 * Stammt die Anfrage von der eigenen Seite auf diesem Rechner?
 * Host-Prüfung gegen DNS-Rebinding, Origin gegen fremde Webseiten, Absender gegen andere Geräte im Netz.
 */
export function isLocalRequest(h: Pick<Headers, "get">, needOrigin: boolean): boolean {
  const host = h.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) return false;
  const from = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!from.every((ip) => LOOPBACK.test(ip))) return false;
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = h.get("origin");
  if (origin ? origin !== `http://${host}` : needOrigin) return false;
  return true;
}
