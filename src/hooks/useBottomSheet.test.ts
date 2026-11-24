import { describe, expect, it } from "vitest";
import { snapAfterDrag } from "./useBottomSheet";

const at = (h: number, v = 0) => snapAfterDrag(h, v, 800, 120);

describe("snapAfterDrag", () => {
  it("rastet ohne Schwung auf der nächstgelegenen Stufe ein", () => {
    expect(at(150)).toBe("peek");
    expect(at(380)).toBe("half");
    expect(at(700)).toBe("full");
  });
  it("folgt schnellem Wischen nach oben", () => {
    expect(at(150, 1)).toBe("half");
    expect(at(420, 1)).toBe("full");
    expect(at(744, 1)).toBe("full");
  });
  it("folgt schnellem Wischen nach unten", () => {
    expect(at(700, -1)).toBe("half");
    expect(at(390, -1)).toBe("peek");
    expect(at(120, -1)).toBe("peek");
  });
});
