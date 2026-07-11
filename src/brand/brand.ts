// ─────────────────────────────────────────────────────────────────────────────
// BRAND — the SINGLE source of truth for the product's identity.
//
// The product NAME, tagline, logo, typography, and the full color palette live
// here and ONLY here. Everything downstream derives from this file:
//   • index.css + tailwind          → app tokens (HSL)
//   • src/lib/exportColors.ts       → xlsx fills (ARGB)
//   • src/pdf/lib/pdfTheme.ts       → PDF theme (hex)
//   • src/lib/subjectColors.ts      → on-screen subject colors (HSL)
// Colors are authored in ONE canonical form (HSL) and converted to hex/ARGB so a
// subject or a brand color is the SAME color on screen, in the spreadsheet, and
// on paper.
// ─────────────────────────────────────────────────────────────────────────────

export interface Hsl { h: number; s: number; l: number }

/** Tailwind CSS-variable token form: "H S% L%" (no `hsl()` wrapper). */
export function hslToken({ h, s, l }: Hsl): string {
  return `${round(h)} ${round(s)}% ${round(l)}%`;
}
/** CSS color: "hsl(H S% L%)". */
export function hslCss({ h, s, l }: Hsl): string {
  return `hsl(${round(h)} ${round(s)}% ${round(l)}%)`;
}
/** Tailwind ARBITRARY-value form (no spaces): "hsl(H_S%_L%)" for `text-[…]`. */
export function hslArbitrary({ h, s, l }: Hsl): string {
  return `hsl(${round(h)}_${round(s)}%_${round(l)}%)`;
}
/** "#RRGGBB". */
export function hslToHex(c: Hsl): string {
  const { r, g, b } = hslToRgb(c);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
}
/** ExcelJS ARGB: "AARRGGBB" (default fully opaque). */
export function hslToArgb(c: Hsl, alpha = "FF"): string {
  return (alpha + hslToHex(c).slice(1)).toUpperCase();
}

function round(n: number): number { return Math.round(n * 100) / 100; }
function hex2(n: number): string { return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"); }
function hslToRgb({ h, s, l }: Hsl): { r: number; g: number; b: number } {
  const S = s / 100, L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = L - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// ── Core palette (canonical HSL) ─────────────────────────────────────────────
// Navy + gold identity on warm paper. AA-checked against paper/white/ink.
export const PALETTE = {
  ink:      { h: 219, s: 46, l: 20 },   // #1B2A4A — headers, strong text, xlsx/pdf ink
  inkText:  { h: 219, s: 45, l: 13 },   // app foreground (near-black navy) — AAA on paper
  navy:     { h: 215, s: 44, l: 30 },   // primary button fill; white text = AA
  navyLift: { h: 214, s: 62, l: 62 },   // dark-mode primary (bright navy-blue)
  gold:     { h: 42,  s: 52, l: 55 },   // #C5A55A — rules, chips, fills, highlights
  goldDeep: { h: 40,  s: 60, l: 38 },   // AA-safe gold for SMALL text on paper (~4.6:1)
  cream:    { h: 44,  s: 62, l: 94 },   // #FBF5E6 — warm band / subtitle fill
  paper:    { h: 40,  s: 33, l: 97 },   // warm off-white page background
  paperCard:{ h: 40,  s: 25, l: 99 },   // warm near-white card
  white:    { h: 0,   s: 0,  l: 100 },
  mute:     { h: 220, s: 9,  l: 40 },   // #5B6270 — secondary text (AA on paper)
  gridline: { h: 223, s: 13, l: 87 },   // table borders (xlsx/pdf/app)
  zebra:    { h: 220, s: 20, l: 97 },   // alternating rows
  success:  { h: 152, s: 55, l: 36 },   // deepened for AA white text
  warning:  { h: 38,  s: 82, l: 48 },
  destructive: { h: 0, s: 68, l: 48 },
} as const;

// ── Subject color band ───────────────────────────────────────────────────────
// ONE saturation/lightness band, distinct hues. Used everywhere (grid / xlsx /
// pdf) so a subject is the same color on every surface.
export const SUBJECT_BAND = {
  accent:     { s: 58, l: 42 },  // text / left-border / chip accent (light mode)
  accentDark: { s: 62, l: 66 },  // same hue, lifted for dark backgrounds
  fill:       { s: 55, l: 95 },  // soft cell fill
} as const;

export const SUBJECT_HUES = {
  pe: 145, art: 24, music: 220, library: 276, science: 194,
  tech: 250, spanish: 352, drama: 312, dance: 330, garden: 96,
} as const;
export type SubjectKey = keyof typeof SUBJECT_HUES;

const SUBJECT_KEYWORDS: Array<[string[], SubjectKey]> = [
  [["pe", "physical", "gym"], "pe"],
  [["art"], "art"],
  [["music"], "music"],
  [["library", "media"], "library"],
  [["science", "stem"], "science"],
  [["tech", "computer", "coding"], "tech"],
  [["spanish", "language", "foreign"], "spanish"],
  [["drama", "theat"], "drama"],
  [["dance"], "dance"],
  [["garden"], "garden"],
];

/** The subject's canonical key (drives static Tailwind class names), or null. */
export function subjectKey(subject?: string | null): SubjectKey | null {
  const s = (subject ?? "").toLowerCase();
  for (const [kws, key] of SUBJECT_KEYWORDS) if (kws.some((k) => s.includes(k))) return key;
  return null;
}

export function subjectHue(subject?: string | null): number | null {
  const k = subjectKey(subject);
  return k === null ? null : SUBJECT_HUES[k];
}

export interface SubjectColors {
  accent: Hsl; fill: Hsl;
  accentHsl: string; fillHsl: string;
  accentArbitrary: string; fillArbitrary: string;
  accentHex: string; fillHex: string;
  accentArgb: string; fillArgb: string;
}

/** Expand a band hue (or the gold/cream fallback) into every representation. */
function bandColorsFor(h: number | null): SubjectColors {
  const accent: Hsl = h === null ? PALETTE.goldDeep : { h, s: SUBJECT_BAND.accent.s, l: SUBJECT_BAND.accent.l };
  const fill: Hsl = h === null ? PALETTE.cream : { h, s: SUBJECT_BAND.fill.s, l: SUBJECT_BAND.fill.l };
  return {
    accent, fill,
    accentHsl: hslToken(accent), fillHsl: hslToken(fill),
    accentArbitrary: hslArbitrary(accent), fillArbitrary: hslArbitrary(fill),
    accentHex: hslToHex(accent), fillHex: hslToHex(fill),
    accentArgb: hslToArgb(accent), fillArgb: hslToArgb(fill),
  };
}

/** Resolve a subject to its canonical color set in every representation. */
export function subjectColorsFor(subject?: string | null): SubjectColors {
  return bandColorsFor(subjectHue(subject));
}

// ── Grade color band ─────────────────────────────────────────────────────────
// Same machinery as subjects: ONE saturation/lightness band, distinct hues per
// grade, so "which grades sit together?" reads at a glance (Specialist Planner
// rails). Adjacent grades get strongly-contrasting hues; TK shares K's color.
export const GRADE_HUES = {
  k: 276, "1": 220, "2": 194, "3": 152, "4": 96, "5": 24, "6": 352, "7": 312, "8": 250,
} as const;
export type GradeKey = keyof typeof GRADE_HUES;

/** Canonical key for a grade label ("K", "TK", "3", "Grade 5"…), or null. */
export function gradeKey(grade?: string | null): GradeKey | null {
  const g = (grade ?? "").trim().toLowerCase();
  if (!g) return null;
  if (/^(t?k\b|t?k$|kinder|pre-?k)/.test(g)) return "k";
  const m = g.match(/[1-8]/);
  return m ? (m[0] as GradeKey) : null;
}

export function gradeHue(grade?: string | null): number | null {
  const k = gradeKey(grade);
  return k === null ? null : GRADE_HUES[k];
}

/** Resolve a grade to its canonical color set (same band as subjects). */
export function gradeColorsFor(grade?: string | null): SubjectColors {
  return bandColorsFor(gradeHue(grade));
}

// ── Product identity ─────────────────────────────────────────────────────────

/**
 * PRODUCT NAME. Default is "Specialist Ops!". The owner has not made a final
 * naming decision — flip `NAME_IS_FINAL` to true once they do, and change `name`
 * here (this is the ONE place the name lives).
 */
export const NAME_IS_FINAL = false;

export const BRAND = {
  name: "Specialist Ops!",
  /** Short marketing line for hero/auth/exports. */
  tagline: "The specials schedule, solved.",
  /** Legacy engine/company name kept for existing links/footers. */
  company: "GoToSpecialClass",
  domain: "GoToSpecialClass.com",
  url: "https://www.GoToSpecialClass.com",
  email: "info@GoToSpecialClass.com",
  logo: {
    /** Import path for React (`@/assets/logo.png.asset.json`). */
    assetJson: "@/assets/logo.png.asset.json",
  },
  typography: {
    /** Web UI font. */
    sans: "Inter",
    /** PDF (@react-pdf) built-in font family + bold variant. */
    pdfSans: "Helvetica",
    pdfSansBold: "Helvetica-Bold",
  },
  /** Attribution used on AI-generated quotes and export footers. */
  attribution: "Specialist Ops!",
} as const;

// ── Derived, ready-to-consume color exports ──────────────────────────────────
// Hex (PDF) and ARGB (xlsx) forms so consumers never re-hardcode a color.
export const BRAND_HEX = {
  ink: hslToHex(PALETTE.ink),
  navy: hslToHex(PALETTE.navy),
  gold: hslToHex(PALETTE.gold),
  goldDeep: hslToHex(PALETTE.goldDeep),
  cream: hslToHex(PALETTE.cream),
  paper: hslToHex(PALETTE.paper),
  white: "#FFFFFF",
  mute: hslToHex(PALETTE.mute),
  gridline: hslToHex(PALETTE.gridline),
  zebra: hslToHex(PALETTE.zebra),
} as const;

export const BRAND_ARGB = {
  ink: hslToArgb(PALETTE.ink),
  navy: hslToArgb(PALETTE.navy),
  gold: hslToArgb(PALETTE.gold),
  goldDeep: hslToArgb(PALETTE.goldDeep),
  cream: hslToArgb(PALETTE.cream),
  paper: hslToArgb(PALETTE.paper),
  white: "FFFFFFFF",
  mute: hslToArgb(PALETTE.mute),
  gridline: hslToArgb(PALETTE.gridline),
  zebra: hslToArgb(PALETTE.zebra),
} as const;
