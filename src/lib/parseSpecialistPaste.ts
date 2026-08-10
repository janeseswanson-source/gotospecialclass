// Paste a specialist roster the same way teachers can be pasted.
//
// The Specialists step only accepted a CSV/XLSX upload, so a coordinator with a
// two-column list in an email had to build a spreadsheet first ("should we just
// be able to copy and paste a list?"). Two columns — name and subject — is all
// this needs; anything else is a bonus.

export interface ParsedSpecialistRow {
  name: string;
  subject: string;
  room: string;
  email: string;
  phone: string;
}

export interface SpecialistParseResult {
  rows: ParsedSpecialistRow[];
  warnings: string[];
  headerDetected: boolean;
}

const HEADER_TOKENS: Record<string, keyof ParsedSpecialistRow> = {
  name: 'name',
  'full name': 'name',
  teacher: 'name',
  'teacher name': 'name',
  'specialist name': 'name',
  'specialist teacher name': 'name',
  specialist: 'name',
  subject: 'subject',
  speciality: 'subject',
  specialty: 'subject',
  'speciality department': 'subject',
  'specialty department': 'subject',
  department: 'subject',
  role: 'subject',
  area: 'subject',
  room: 'room',
  'room number': 'room',
  'room no': 'room',
  'room #': 'room',
  location: 'room',
  email: 'email',
  'email address': 'email',
  'e mail': 'email',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
};

const POSITIONAL_ORDER: (keyof ParsedSpecialistRow)[] = ['name', 'subject', 'room', 'email', 'phone'];

/** Canonical subjects the wizard already knows, plus the spellings schools use. */
const SUBJECT_ALIASES: Record<string, string> = {
  art: 'Art',
  visualart: 'Art',
  visualarts: 'Art',
  tech: 'Tech',
  technology: 'Tech',
  computer: 'Tech',
  computers: 'Tech',
  computerlab: 'Tech',
  stem: 'STEAM',
  steam: 'STEAM',
  pe: 'PE',
  physicaleducation: 'PE',
  gym: 'PE',
  health: 'PE',
  music: 'Music',
  band: 'Music',
  chorus: 'Music',
  library: 'Library',
  librarian: 'Library',
  media: 'Library',
  garden: 'Garden',
  gardening: 'Garden',
  science: 'Science',
  sciencelab: 'Science',
  counselor: 'Counselor',
  counseling: 'Counselor',
};

function cleanToken(s: string): string {
  // `trim()` also strips a leading U+FEFF byte-order mark — see the note in
  // parseTeacherPaste.ts.
  let t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function normalizeHeaderToken(s: string): string {
  return cleanToken(s)
    .toLowerCase()
    // Template headers carry a parenthetical hint:
    // "Specialist (Art / Tech / PE / Music / Library...)".
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "physical education" / "Computer Lab" → the wizard's own subject names. */
export function normalizeSubject(raw: string): string {
  const key = cleanToken(raw).toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return '';
  return SUBJECT_ALIASES[key] ?? cleanToken(raw);
}

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(',')) return line.split(',');
  if (line.includes(';')) return line.split(';');
  if (line.includes(' - ')) return line.split(' - ');
  if (/ {2,}/.test(line)) return line.split(/ {2,}/);
  return [line];
}

function detectHeader(tokens: string[]): { isHeader: boolean; map: Record<number, keyof ParsedSpecialistRow> } {
  const map: Record<number, keyof ParsedSpecialistRow> = {};
  const claimed = new Set<keyof ParsedSpecialistRow>();
  let matches = 0;
  tokens.forEach((tok, i) => {
    const field = HEADER_TOKENS[normalizeHeaderToken(tok)];
    if (!field) return;
    matches++;
    // FIRST column wins a field. The shipped template's own header is
    // "Teacher Name, Specialist (Art / Tech / …)" — both words mean `name`, and
    // letting the second overwrite the first put the SUBJECT in the name field
    // and left every specialist unnamed. The loser is filled in positionally.
    if (claimed.has(field)) return;
    claimed.add(field);
    map[i] = field;
  });
  return { isHeader: tokens.length > 0 && (matches >= 2 || matches / tokens.length >= 0.5), map };
}

export function parseSpecialistPaste(text: string): SpecialistParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const warnings: string[] = [];
  const rows: ParsedSpecialistRow[] = [];
  if (lines.length === 0) return { rows, warnings, headerDetected: false };

  const firstTokens = splitLine(lines[0]).map(cleanToken);
  const { isHeader, map } = detectHeader(firstTokens);

  // Any column the header didn't bind gets the next unused field, in order.
  // This is what rescues a header that names no `name` column (every row would
  // otherwise be dropped) and a header whose words collide.
  if (isHeader) {
    const mapped = new Set(Object.values(map));
    const hadName = mapped.has('name');
    const free = POSITIONAL_ORDER.filter((f) => !mapped.has(f));
    firstTokens.forEach((_t, i) => {
      if (map[i]) return;
      const next = free.shift();
      if (next) map[i] = next;
    });
    if (!hadName) {
      warnings.push("Couldn't tell which column holds the specialist's name — used the first unlabelled column.");
    }
  }

  const dataLines = isHeader ? lines.slice(1) : lines;
  dataLines.forEach((line, idx) => {
    const rowNum = isHeader ? idx + 2 : idx + 1;
    const tokens = splitLine(line).map(cleanToken);
    const row: ParsedSpecialistRow = { name: '', subject: '', room: '', email: '', phone: '' };

    tokens.forEach((tok, i) => {
      const field = isHeader ? map[i] : POSITIONAL_ORDER[i];
      if (field) row[field] = tok;
    });

    if (!row.name) {
      warnings.push(`Row ${rowNum} skipped: no name`);
      return;
    }
    row.subject = normalizeSubject(row.subject);
    rows.push(row);
  });

  return { rows, warnings, headerDetected: isHeader };
}
