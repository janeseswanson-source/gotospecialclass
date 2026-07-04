// Pure helpers that turn AI-parser output into the setup wizard's review-table
// shapes, plus the prefill-merge used when AI-extracted data seeds the wizard
// without clobbering fields the user already filled. Framework-free + unit-tested
// so the review tables and the Quick-Setup fan-out share ONE mapping and can't
// drift from the parser contracts.

export const SPECIALIST_SUBJECTS = [
  "Art", "Music", "PE", "Library", "STEAM", "Technology", "Science Lab", "Garden", "Other",
] as const;
export type SpecialistSubject = (typeof SPECIALIST_SUBJECTS)[number];

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export interface SpecialistImportRow {
  name: string;
  subject: SpecialistSubject;
  workingDays: string[];
  location: string;
  phone: string;
  email: string;
  twoSchools: boolean;
  secondSchoolName: string;
}

export interface TeacherImportRow {
  name: string;
  grade: string;
  room: string;
  preferences: string;
}

/** Map a fuzzy subject label onto the allowed specialist set. */
export function normalizeSubject(raw: unknown): SpecialistSubject {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "Other";
  if (/(^|\b)(pe|p\.e\.|phys|gym)/.test(s)) return "PE";
  if (/art/.test(s)) return "Art";
  if (/music|band|choir|orchestra/.test(s)) return "Music";
  if (/librar|media/.test(s)) return "Library";
  if (/steam|stem/.test(s)) return "STEAM";
  if (/tech|comput|coding|digital/.test(s)) return "Technology";
  if (/science/.test(s)) return "Science Lab";
  if (/garden/.test(s)) return "Garden";
  // Exact-match passthrough for already-clean values.
  const exact = SPECIALIST_SUBJECTS.find((x) => x.toLowerCase() === s);
  return exact ?? "Other";
}

/** Normalize a grade token to "PreK","K","1".."8" or a combo like "K-1"; "" if none. */
export function normalizeGrade(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // Combo like "K-1", "1-2" — checked BEFORE single-grade rules so "K-1" isn't
  // swallowed by the "starts with K" case.
  const combo = s.match(/^\s*(pre-?k|k|\d)\s*[–-]\s*(k|\d)\s*$/i);
  if (combo) return `${normalizeGrade(combo[1])}-${normalizeGrade(combo[2])}`;
  if (/^pre-?k/i.test(s)) return "PreK";
  if (/^(k|kinder)/i.test(s)) return "K";
  const ordinal = s.match(/(\d+)\s*(st|nd|rd|th)?/);
  if (ordinal) {
    const n = Number(ordinal[1]);
    if (n >= 1 && n <= 8) return String(n);
  }
  return "";
}

/** Coerce various "working days" phrasings to a Mon–Fri subset (blank = all five). */
export function normalizeDays(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const kept = raw.map((d) => String(d).trim()).filter((d) => WEEK_DAYS.includes(d));
    return kept.length ? kept : [...WEEK_DAYS];
  }
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "all" || /mon\s*-\s*fri|m-f/.test(s)) return [...WEEK_DAYS];
  const out: string[] = [];
  const has = (re: RegExp) => re.test(s);
  if (has(/mon|mwf|\bm\b/)) out.push("Mon");
  if (has(/tue|tues|\btth?\b|t\/th/)) out.push("Tue");
  if (has(/wed|mwf|\bw\b/)) out.push("Wed");
  if (has(/thu|thur|\btth?\b|t\/th/)) out.push("Thu");
  if (has(/fri|mwf|\bf\b/)) out.push("Fri");
  return out.length ? [...new Set(out)] : [...WEEK_DAYS];
}

/** parse-specialist-template `specialists[]` → review rows (drops nameless rows). */
export function mapParsedSpecialists(raw: unknown): SpecialistImportRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: any): SpecialistImportRow => ({
      name: String(s?.name ?? "").trim(),
      subject: normalizeSubject(s?.subject),
      workingDays: normalizeDays(s?.working_days),
      location: String(s?.location ?? "").trim(),
      phone: String(s?.phone ?? "").trim(),
      email: String(s?.email ?? "").trim(),
      twoSchools: Boolean(s?.two_schools),
      secondSchoolName: String(s?.second_school_name ?? "").trim(),
    }))
    .filter((s) => s.name.length > 0);
}

/** parse-teacher-roster `teachers[]` → review rows (drops nameless rows). */
export function mapParsedTeachers(raw: unknown): TeacherImportRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t: any): TeacherImportRow => ({
      name: String(t?.name ?? "").trim(),
      grade: normalizeGrade(t?.grade),
      room: String(t?.room ?? "").trim(),
      preferences: String(t?.preferences ?? "").trim(),
    }))
    .filter((t) => t.name.length > 0);
}

/** True when a value should be treated as "not yet set" for prefill purposes. */
export function isUnset(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false; // numbers / booleans are considered set
}

/**
 * Merge AI-extracted `seed` into `prev`, filling ONLY fields the user hasn't set
 * (empty string / empty array / null). Never clobbers in-flight edits — the same
 * rule the SetupContext hydration uses, made pure so the Quick-Setup fan-out and
 * the reducer test share it.
 */
export function mergePrefill<T extends Record<string, any>>(prev: T, seed: Partial<T>): T {
  const out: T = { ...prev };
  for (const key of Object.keys(seed) as (keyof T)[]) {
    const incoming = seed[key];
    if (isUnset(prev[key]) && !isUnset(incoming)) {
      out[key] = incoming as T[keyof T];
    }
  }
  return out;
}
