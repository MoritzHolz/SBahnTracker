import type { BrowserContext, Page as PwPage } from "playwright";
import { parseFormation, type RawBoardRow, type Unit } from "./parse.ts";

/** Seite verweigert den automatischen Zugriff. Wird nie umgangen, nur gemeldet. */
export class SiteBlocked extends Error {}

async function open(page: PwPage, url: string): Promise<void> {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const host = new URL(url).host;
  const status = res?.status() ?? 0;
  if ([401, 403, 407, 429, 451].includes(status)) throw new SiteBlocked(`${host} verweigert den Zugriff (HTTP ${status}).`);
  if (status >= 400 || status === 0) throw new Error(`${host} antwortet mit HTTP ${status || "–"}.`);
  if (new URL(page.url()).host !== host) throw new SiteBlocked(`${host} leitet auf eine andere Seite um.`);
  const guarded = await page.evaluate(
    () =>
      !!document.querySelector(
        'input[type=password], iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, #challenge-form',
      ),
  );
  if (guarded) throw new SiteBlocked(`${host} verlangt Anmeldung oder CAPTCHA. Das wird nicht umgangen.`);
}

/** Abfahrtstafel von dbf.finalrewind.org ablesen. */
export async function readDbfBoard(ctx: BrowserContext, url: string): Promise<RawBoardRow[]> {
  const page = await ctx.newPage();
  try {
    await open(page, url);
    await page.waitForSelector(".app li[data-train]", { timeout: 20_000 }).catch(() => {
      throw new Error("Keine Abfahrten auf der Seite gefunden (Seite leer oder umgebaut).");
    });
    return await page.$$eval(".app li[data-train]", (els) =>
      els.map((el) => {
        const d = (k: string) => el.getAttribute(`data-${k}`);
        const time = el.querySelector(".time");
        return {
          train: d("train"), line: d("line"), no: d("no"), linetype: d("linetype"), from: d("from"), to: d("to"),
          platform: d("platform"), arrival: d("arrival"), departure: d("departure"),
          routePrev: d("routeprev"), routeNext: d("routenext"),
          timeClass: time?.getAttribute("class") ?? null,
          timeText: time?.textContent ?? null,
          info: el.querySelector(".info")?.textContent ?? null,
          cancelled: el.classList.contains("cancelled"),
        };
      }),
    );
  } finally {
    await page.close().catch(() => {});
  }
}

/** bahn.expert: Abfahrtsliste offen halten und einzelne Züge aufklappen. */
export class BahnExpertBoard {
  private page: PwPage;
  private constructor(page: PwPage) {
    this.page = page;
  }

  static async open(ctx: BrowserContext, url: string): Promise<BahnExpertBoard> {
    // Reguläre Anzeige-Einstellungen der Seite (Menü → Einstellungen): EVN, Fahrzeuggruppe, Fahrtnummer anzeigen
    await ctx.addCookies(
      ["showEVN", "fahrzeugGruppe", "lineAndNumber"].map((name) => ({ name, value: "true", url: new URL(url).origin })),
    );
    const page = await ctx.newPage();
    await open(page, url);
    await page
      .waitForFunction(() => [...document.querySelectorAll("main *")].some((e) => !e.children.length && /^S \d{2,6}$/.test(e.textContent!.trim())), null, {
        timeout: 25_000,
      })
      .catch(() => {
        throw new Error("bahn.expert: keine S-Bahn-Fahrten gefunden (Seite leer oder umgebaut).");
      });
    return new BahnExpertBoard(page);
  }

  async trainNumbers(): Promise<string[]> {
    return this.page.$$eval("main *", (els) => [
      ...new Set(
        els.filter((e) => !e.children.length).map((e) => /^S (\d{2,6})$/.exec(e.textContent!.trim())?.[1]).filter((x): x is string => !!x),
      ),
    ]);
  }

  /** Zug aufklappen und sichtbare Wagenreihung lesen. Leeres Ergebnis = Seite zeigt keine Fahrzeugnummern. */
  async readFormation(trainNumber: string): Promise<Unit[]> {
    const label = `S ${trainNumber}`;
    await this.page.locator("main").getByText(label, { exact: true }).first().click({ timeout: 10_000 });
    const read = () =>
      this.page.evaluate((label) => {
        const link = [...document.querySelectorAll('main a[href^="/details/"]')].find((a) =>
          decodeURIComponent(a.getAttribute("href")!).startsWith(`/details/${label}/`),
        );
        if (!link) return null;
        // Kleinster umgebender Block, der die Details genau dieses Zuges enthält
        let el: Element = link;
        while (el.parentElement && el.parentElement.tagName !== "MAIN") {
          const p = el.parentElement;
          const others = [...p.querySelectorAll("*")].filter((e) => !e.children.length && /^S \d{2,6}$/.test(e.textContent!.trim()) && e.textContent!.trim() !== label);
          if (others.length) break;
          el = p;
        }
        return [...el.querySelectorAll("*")].filter((e) => !e.children.length).map((e) => e.textContent!.trim()).filter(Boolean);
      }, label);

    let texts: string[] | null = null;
    for (let i = 0; i < 16; i++) {
      await this.page.waitForTimeout(500);
      texts = await read();
      if (texts && parseFormation(texts).length) {
        // kurz warten, bis alle Einheiten gerendert sind
        await this.page.waitForTimeout(400);
        texts = await read();
        break;
      }
    }
    if (!texts) throw new Error(`bahn.expert: Details zu ${label} ließen sich nicht öffnen.`);
    return parseFormation(texts);
  }

  async close(): Promise<void> {
    await this.page.close().catch(() => {});
  }
}
