import { afterEach, describe, expect, it } from "vitest";
import { KeepAwake, SleepDetector, sleepReason } from "./awake.ts";

describe("SleepDetector", () => {
  it("meldet im normalen Takt nichts", () => {
    const d = new SleepDetector(20_000, 0);
    expect(d.tick(2_000)).toBe(0);
    expect(d.tick(22_000)).toBe(0);
  });
  it("meldet eine Pause genau einmal", () => {
    const d = new SleepDetector(20_000, 0);
    expect(d.tick(297_000)).toBe(297_000);
    expect(d.tick(299_000)).toBe(0);
  });
  it("ignoriert eine zurückgestellte Uhr", () => {
    const d = new SleepDetector(20_000, 100_000);
    expect(d.tick(40_000)).toBe(0);
    expect(d.tick(42_000)).toBe(0);
  });
  it("beschreibt die Dauer", () => {
    expect(sleepReason(45_000)).toBe("Rechner war 45 s im Ruhezustand, Scan abgebrochen");
    expect(sleepReason(297_000)).toBe("Rechner war 5 min im Ruhezustand, Scan abgebrochen");
  });
});

describe("KeepAwake", () => {
  const all: KeepAwake[] = [];
  const make = (cmd: string | null) => {
    const k = new KeepAwake(cmd);
    all.push(k);
    return k;
  };
  afterEach(() => all.splice(0).forEach((k) => k.hold(false)));

  it("bleibt ohne Programm ohne Wirkung", () => {
    const k = make(null);
    k.hold(true);
    expect(k.active).toBe(false);
  });
  it("übersteht ein fehlendes Programm", async () => {
    const k = make("/gibt/es/nicht");
    k.hold(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(k.active).toBe(false);
  });
  it.runIf(process.platform === "darwin")("schaltet ein und wieder aus", () => {
    const k = make("/usr/bin/caffeinate");
    k.hold(true);
    k.hold(true);
    expect(k.active).toBe(true);
    k.hold(false);
    expect(k.active).toBe(false);
  });
});
