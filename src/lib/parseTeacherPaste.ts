export interface ParsedTeacherRow {
  name: string;
  grade: string;
  room: string;
  team: string;
  phone: string;
  email: string;
}

export interface ParseResult {
  rows: ParsedTeacherRow[];
  warnings: string[];
  headerDetected: boolean;
}

const HEADER_TOKENS: Record<string, keyof ParsedTeacherRow> = {
  name: 'name',
  'full name': 'name',
  teacher: 'name',
  'teacher name': 'name',
  'classroom teacher': 'name',
  'classroom teacher name': 'name',
  'homeroom teacher': 'name',
  'last name': 'name',
  grade: 'grade',
  'grade level': 'grade',
  level: 'grade',
  room: 'room',
  'room number': 'room',
  'room no': 'room',
  'room #': 'room',
  team: 'team',
  'team name': 'team',
  group: 'team',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  ext: 'phone',
  email: 'email',
  'email address': 'email',
  'e mail': 'email',
};

const POSITIONAL_ORDER: (keyof ParsedTeacherRow)[] = ['name', 'grade', 'room', 'team', 'phone', 'email'];

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(',')) return line.split(',');
  if (line.includes(';')) return line.split(';');
  if (/ {2,}/.test(line)) return line.split(/ {2,}/);
  return [line];
}

function cleanToken(s: string): string {
  // `trim()` also removes the U+FEFF byte-order mark that spreadsheet exports
  // put on the first cell (it counts as whitespace in ECMA-262), so a BOM'd
  // "name" header still matches. Covered by a test.
  let t = s.trim();
  // strip matched surrounding quotes
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** Header cells arrive as `teacher_name`, `Room #`, `E-Mail`… — compare on a
 *  single normalised form instead of listing every spelling. */
function normalizeHeaderToken(s: string): string {
  return cleanToken(s)
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGrade(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return '';
  if (['k', 'kindergarten', 'kinder', '0'].includes(t)) return 'K';
  if (['pre-k', 'prek', 'pk'].includes(t)) return 'Pre-K';
  if (t === 'tk') return 'TK';
  if (/^[1-6]$/.test(t)) return t;
  if (/^grade\s*([1-6])$/.test(t)) return t.replace(/^grade\s*/, '');
  return raw.trim();
}

function detectHeader(tokens: string[]): { isHeader: boolean; map: Record<number, keyof ParsedTeacherRow> } {
  const map: Record<number, keyof ParsedTeacherRow> = {};
  const claimed = new Set<keyof ParsedTeacherRow>();
  let matches = 0;
  tokens.forEach((tok, i) => {
    const field = HEADER_TOKENS[normalizeHeaderToken(tok)];
    if (!field) return;
    matches++;
    // First column to claim a field keeps it; a later synonym ("Teacher" after
    // "Teacher Name") would otherwise overwrite real data. Losers are filled
    // in positionally below.
    if (claimed.has(field)) return;
    claimed.add(field);
    map[i] = field;
  });
  // Two unambiguous header words are enough ("Name, Grade" is a real roster);
  // requiring 60% of cells to match rejected perfectly good headers that carry
  // one extra column we don't know about.
  const isHeader = tokens.length > 0 && (matches >= 2 || matches / tokens.length >= 0.5);
  return { isHeader, map };
}

export function inferTeamFromGrade(grade: string): string {
  const g = grade.trim();
  if (!g) return '';
  if (g === 'K') return 'Kinder Team';
  if (g === 'Pre-K') return 'Pre-K Team';
  if (g === 'TK') return 'TK Team';
  if (/^[1-6]$/.test(g)) return `Grade ${g} Team`;
  return '';
}

const SENTENCE_PATTERNS: RegExp[] = [
  // "Mrs. Smith teaches Kindergarten in room 101" / "...in 101"
  /^(?:mr\.?|mrs\.?|ms\.?|miss|mx\.?|dr\.?)?\s*([a-z' .-]+?)\s+(?:teaches|teaching)\s+([a-z0-9 -]+?)(?:\s+in\s+(?:room\s*)?([a-z0-9-]+))?\.?$/i,
  // "Smith - Grade 2 - Room 204" or with | or –
  /^([a-z' .-]+?)\s*[-–|]\s*(?:grade\s*)?([a-z0-9-]+)\s*[-–|]\s*(?:room\s*)?([a-z0-9-]+)\.?$/i,
];

function tryNaturalLanguage(line: string): ParsedTeacherRow | null {
  const trimmed = line.trim();
  for (const re of SENTENCE_PATTERNS) {
    const m = trimmed.match(re);
    if (m) {
      const name = (m[1] || '').replace(/^(mr|mrs|ms|mx|dr|miss)\.?\s+/i, '').trim();
      if (!name) continue;
      return { name, grade: normalizeGrade(m[2] || ''), room: (m[3] || '').trim(), team: '', phone: '', email: '' };
    }
  }
  return null;
}

export function parseTeacherPaste(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map(l => l).filter(l => l.trim().length > 0);
  const warnings: string[] = [];
  const rows: ParsedTeacherRow[] = [];

  if (lines.length === 0) {
    return { rows, warnings, headerDetected: false };
  }

  const firstTokens = splitLine(lines[0]).map(cleanToken);
  const { isHeader, map } = detectHeader(firstTokens);
  const dataLines = isHeader ? lines.slice(1) : lines;

  // A header we recognise but that binds no NAME column would drop every row
  // ("Row 2 skipped: no name" — which is exactly what the app's own shipped
  // template used to do). Treat the unmapped columns as positional instead,
  // so the name still lands.
  if (isHeader) {
    const mappedFields = new Set(Object.values(map));
    const hadName = mappedFields.has('name');
    const freeFields = POSITIONAL_ORDER.filter((f) => !mappedFields.has(f));
    firstTokens.forEach((_tok, i) => {
      if (map[i]) return;
      const next = freeFields.shift();
      if (next) map[i] = next;
    });
    if (!hadName) {
      warnings.push(
        "Couldn't tell which column holds the teacher's name — used the first unlabelled column. Check the names below.",
      );
    }
  }

  dataLines.forEach((line, idx) => {
    const rowNum = (isHeader ? idx + 2 : idx + 1);
    const tokens = splitLine(line).map(cleanToken);
    const row: ParsedTeacherRow = { name: '', grade: '', room: '', team: '', phone: '', email: '' };

    if (isHeader) {
      tokens.forEach((tok, i) => {
        const field = map[i];
        if (field) row[field] = tok;
      });
    } else if (tokens.length === 1) {
      // No delimiter — try natural-language parse first
      const nl = tryNaturalLanguage(line);
      if (nl) {
        Object.assign(row, nl);
      } else {
        row.name = tokens[0];
      }
    } else {
      tokens.forEach((tok, i) => {
        const field = POSITIONAL_ORDER[i];
        if (field) row[field] = tok;
      });
    }

    if (!row.name) {
      warnings.push(`Row ${rowNum} skipped: no name`);
      return;
    }

    row.grade = normalizeGrade(row.grade);
    if (!row.team) row.team = inferTeamFromGrade(row.grade);
    rows.push(row);
  });

  if (!isHeader && firstTokens.length > 0 && tokensLookLikeHeaderHint(firstTokens)) {
    warnings.push('No header row detected — using positional mapping: Name, Grade, Room, Team, Phone, Email.');
  }

  return { rows, warnings, headerDetected: isHeader };
}

function tokensLookLikeHeaderHint(tokens: string[]): boolean {
  // If first token contains digits or is short like a grade marker, no hint needed
  return tokens.length >= 4;
}
