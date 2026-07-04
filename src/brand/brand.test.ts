import { describe, it, expect } from "vitest";
import {
  BRAND,
  BRAND_HEX,
  BRAND_ARGB,
  PALETTE,
  SUBJECT_HUES,
  subjectKey,
  subjectColorsFor,
  hslToHex,
  hslToArgb,
} from "./brand";

// Snapshot of the brand token EXPOSURE — the public identity surface every
// downstream consumer (css/tailwind/xlsx/pdf) derives from. If any of these
// change, the change is intentional and the snapshot must be updated knowingly.
describe("brand token exposure", () => {
  it("exposes a stable identity + palette surface", () => {
    expect({
      name: BRAND.name,
      tagline: BRAND.tagline,
      domain: BRAND.domain,
      attribution: BRAND.attribution,
      typography: BRAND.typography,
      hex: BRAND_HEX,
      argb: BRAND_ARGB,
    }).toMatchSnapshot();
  });

  it("keeps hex and ARGB in lockstep with the canonical HSL", () => {
    expect(BRAND_HEX.ink).toBe(hslToHex(PALETTE.ink));
    expect(BRAND_ARGB.ink).toBe(hslToArgb(PALETTE.ink));
    expect(BRAND_ARGB.gold).toBe("FF" + BRAND_HEX.gold.slice(1));
  });
});

describe("subject color band", () => {
  it("maps subjects (incl. fuzzy names) to a distinct hue", () => {
    expect(subjectKey("Physical Education")).toBe("pe");
    expect(subjectKey("art studio")).toBe("art");
    expect(subjectKey("STEM Lab")).toBe("science");
    expect(subjectKey("Underwater Basket Weaving")).toBeNull();
  });

  it("produces every representation from ONE hue so screen=paper=sheet", () => {
    const c = subjectColorsFor("music");
    expect(c.accentHex).toBe(hslToHex(c.accent));
    expect(c.accentArgb).toBe(hslToArgb(c.accent));
    // ARGB is just the opaque form of the hex.
    expect(c.accentArgb).toBe("FF" + c.accentHex.slice(1));
  });

  it("falls back to the deep brand gold for unknown subjects", () => {
    expect(subjectColorsFor("Underwater Basket Weaving").accentArgb).toBe(BRAND_ARGB.goldDeep);
  });

  it("keeps all subject hues distinct", () => {
    const hues = Object.values(SUBJECT_HUES);
    expect(new Set(hues).size).toBe(hues.length);
  });
});
