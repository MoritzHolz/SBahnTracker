import { describe, expect, it } from "vitest";
import { isLocalRequest } from "./localRequest";

const req = (h: Record<string, string>) => isLocalRequest(new Headers(h), true);
const ok = { host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": "::1", "sec-fetch-site": "same-origin" };

describe("isLocalRequest", () => {
  it("erlaubt die eigene Seite auf diesem Rechner", () => {
    expect(req(ok)).toBe(true);
    expect(req({ ...ok, "x-forwarded-for": "::ffff:127.0.0.1" })).toBe(true);
  });
  it("lehnt fremde Seiten, fremde Hosts und andere Geräte ab", () => {
    expect(req({ ...ok, origin: "https://boese.example" })).toBe(false);
    expect(req({ ...ok, "sec-fetch-site": "cross-site" })).toBe(false);
    expect(req({ ...ok, host: "boese.example:3000", origin: "http://boese.example:3000" })).toBe(false);
    expect(req({ ...ok, host: "localhost.boese.example" })).toBe(false);
    expect(req({ ...ok, "x-forwarded-for": "192.168.1.20" })).toBe(false);
    expect(req({ ...ok, "x-forwarded-for": "127.0.0.1, 192.168.1.20" })).toBe(false);
    expect(req({ host: ok.host })).toBe(false);
  });
});
