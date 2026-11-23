// robots.txt wird vor jedem Zugriff beachtet (12 h zwischengespeichert).

export interface Robots {
  rules: { allow: boolean; path: string }[];
  crawlDelaySec: number;
}

export function parseRobots(text: string): Robots {
  const rules: Robots["rules"] = [];
  let crawlDelaySec = 0;
  let agents: string[] = [];
  let inRules = false;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([a-z-]+)\s*:\s*([^#]*)/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(val.toLowerCase());
      continue;
    }
    if (key === "sitemap") continue;
    inRules = true;
    if (!agents.includes("*")) continue;
    if (key === "disallow" && val) rules.push({ allow: false, path: val });
    if (key === "allow" && val) rules.push({ allow: true, path: val });
    if (key === "crawl-delay") crawlDelaySec = Math.max(crawlDelaySec, Number(val) || 0);
  }
  return { rules, crawlDelaySec };
}

function matches(rule: string, path: string): boolean {
  const re = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
  return new RegExp("^" + re).test(path);
}

export function isAllowed(r: Robots, path: string): boolean {
  let best: { allow: boolean; path: string } | null = null;
  for (const rule of r.rules) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best?.allow ?? true;
}

const cache = new Map<string, { at: number; robots: Robots }>();

export async function loadRobots(origin: string, userAgent: string, signal: AbortSignal): Promise<Robots> {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.robots;
  const res = await fetch(`${origin}/robots.txt`, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (res.status >= 500 || res.status === 429) throw new Error(`robots.txt nicht abrufbar (HTTP ${res.status})`);
  const robots = res.ok ? parseRobots(await res.text()) : { rules: [], crawlDelaySec: 0 };
  cache.set(origin, { at: Date.now(), robots });
  return robots;
}
