import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { addDays, formatWeekHeader, formatDayHeader } from './lib/weekDates';
import { getDayLabelFor, type SchoolCalendarEvent } from './lib/holidays';
import { pickQuoteForWeek } from './lib/quotes';
import { PDF, PDF_BRAND, pdfSubjectColors } from './lib/pdfTheme';
import { friendlyBandLabel } from '@/lib/scheduleGrid';
import { formatGradeOrdinal } from '@/lib/gradeOrdinal';
import logoAsset from '@/assets/logo.png.asset.json';

const LOGO_URL = (() => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(logoAsset.url, window.location.origin).toString();
  }
  return logoAsset.url;
})();

export interface RecessRow {
  grade_band: string;
  am_recess_start?: string | null;
  am_recess_end?: string | null;
  lunch_start?: string | null;
  lunch_end?: string | null;
  pm_recess_start?: string | null;
  pm_recess_end?: string | null;
}

export interface PlannerBlock {
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject?: string | null;
  specialist_id?: string | null;
  specialist_name?: string | null;
  teacher_name?: string | null;
  grade?: string | null;
  week_label?: string | null;
  notes?: string | null;
}

export interface SchoolHours {
  start?: string | null;
  end?: string | null;
  /** e.g. "Wed" or "Wednesday" — drives the "School Ends 1:15" day note. */
  earlyReleaseDay?: string | null;
  earlyReleaseEnd?: string | null;
}

export interface SpecialistPlannerProps {
  specialists: { id: string; name: string; subject: string }[];
  blocks: PlannerBlock[];
  schoolName?: string;
  schoolYear?: string;
  weeks: Date[];
  weekLabels?: (undefined | 'A' | 'B')[]; // one or more; default [undefined]
  recessConfig?: RecessRow[];
  /** grade_band key → friendly label (schools.recess_grade_bands) so print never
   *  shows raw auto-generated band_ keys. */
  bandLabels?: Record<string, string> | null;
  includeNotesBox?: boolean;
  /** Approved school calendar events — drive HOLIDAY/PD day notes + stripes. */
  calendarEvents?: SchoolCalendarEvent[];
  /** Bell times incl. early release ("School Ends 1:15 Wed else 2:00"). */
  schoolHours?: SchoolHours;
  /** The chosen (AI or fallback) motivational quote for the footer. Falls back
   *  to the deterministic weekly pick when not supplied. */
  quote?: string | null;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Subject colors come from the shared brand band (same hue as grid + xlsx).
const getSubjectColors = pdfSubjectColors;

const C = {
  ink: PDF.ink,
  navy: PDF.navy,
  gold: PDF.gold,
  border: PDF.border,
  borderLight: PDF.borderLight,
  mute: PDF.mute,
  band: PDF.band,
  zebra: PDF.zebra,
  white: PDF.white,
  open: PDF.mute,
  stripe: 'rgba(200,164,81,0.25)',
};

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 9, fontFamily: 'Helvetica', color: C.ink },
  header: { flexDirection: 'row', borderBottom: `1.5pt solid ${C.gold}`, paddingBottom: 8, marginBottom: 8 },
  headerLeft: { width: '34%' },
  headerCenter: { width: '33%', paddingHorizontal: 8 },
  headerRight: { width: '33%', paddingLeft: 8 },
  subject: { fontSize: 20, fontWeight: 'bold', letterSpacing: 1 },
  headerMute: { fontSize: 9, color: C.mute, marginTop: 3 },
  weekOf: { fontSize: 13, fontWeight: 'bold', marginTop: 2 },
  checkRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  checkItem: { flexDirection: 'row', alignItems: 'center', width: '50%', marginBottom: 4 },
  checkBox: { width: 9, height: 9, border: `0.8pt solid ${C.ink}`, marginRight: 4 },
  checkLabel: { fontSize: 8.5 },
  notesLabel: { fontSize: 9, fontWeight: 'bold', marginBottom: 4 },
  notesLine: { borderBottom: `0.5pt solid ${C.border}`, height: 11, marginTop: 5 },
  loadLabel: { fontSize: 7, color: C.mute, marginTop: 7 },

  gridHeader: { flexDirection: 'row', backgroundColor: C.ink, color: C.white },
  gridHeaderCell: { padding: 4, fontSize: 8, fontWeight: 'bold', textAlign: 'center', borderRight: `0.5pt solid ${C.navy}` },
  timeColHeader: { width: 60 },
  dayColHeader: { flex: 1 },

  // Thin day-note strip under the day header: holiday / PD / waiver / early
  // release live in FLOW layout (never absolutely positioned — see git blame
  // for the misaligning overlay this replaced).
  dayNoteRow: { flexDirection: 'row', borderBottom: `0.5pt solid ${C.borderLight}`, minHeight: 12 },
  dayNoteSpacer: { width: 60, borderRight: `0.5pt solid ${C.borderLight}` },
  dayNoteCell: { flex: 1, paddingVertical: 1, paddingHorizontal: 2, borderRight: `0.5pt solid ${C.borderLight}`, justifyContent: 'center' },
  dayNoteText: { fontSize: 6.5, fontWeight: 'bold', textAlign: 'center', color: C.ink },
  dayNoteMute: { fontSize: 6.5, fontStyle: 'italic', textAlign: 'center', color: C.mute },

  row: { flexDirection: 'row', borderBottom: `0.5pt solid ${C.borderLight}`, minHeight: 26 },
  timeCell: { width: 60, padding: 3, fontSize: 8, color: C.mute, borderRight: `0.5pt solid ${C.borderLight}`, textAlign: 'center', justifyContent: 'center' },
  dayCell: { flex: 1, padding: 3, fontSize: 8.5, borderRight: `0.5pt solid ${C.borderLight}`, justifyContent: 'center', alignItems: 'center' },

  bandRow: { flexDirection: 'row', backgroundColor: C.band, borderTop: `0.5pt solid ${C.gold}`, borderBottom: `0.5pt solid ${C.gold}`, minHeight: 20, alignItems: 'center' },
  bandKind: { width: 60, padding: 3, fontSize: 7, fontWeight: 'bold', textAlign: 'center', color: C.ink, borderRight: `0.5pt solid ${C.gold}` },
  dutyChip: { fontSize: 7, fontWeight: 'bold', color: C.ink, border: `0.8pt solid ${C.gold}`, backgroundColor: C.white, paddingHorizontal: 4, paddingVertical: 2, marginLeft: 4 },
  bandText: { flex: 1, padding: 3, fontSize: 8, fontWeight: 'bold', textAlign: 'center', color: C.ink },

  openText: { color: C.open, fontStyle: 'italic' },
  planningText: { color: C.mute, fontStyle: 'italic' },
  classText: { textAlign: 'center', fontWeight: 'bold' },
  cellTime: { fontSize: 6.5, color: C.mute, textAlign: 'center', marginTop: 1 },
  cellNotes: { fontSize: 6.5, fontStyle: 'italic', color: C.mute, textAlign: 'center', marginTop: 1 },
  footnotesBox: { marginTop: 6, padding: 4, border: `0.5pt dashed ${C.gold}` },
  footnotesTitle: { fontSize: 7, fontWeight: 'bold', color: C.ink, marginBottom: 2 },
  footnoteRow: { flexDirection: 'row', marginTop: 1 },
  footnoteDay: { fontSize: 6.5, color: C.mute, width: 36 },
  footnoteText: { fontSize: 6.5, color: C.ink, flex: 1 },

  notesBox: { marginTop: 8, border: `1pt solid ${C.gold}`, padding: 6, height: 92 },
  notesTitle: { fontSize: 9, fontWeight: 'bold', marginBottom: 4 },
  notesRule: { borderBottom: `0.4pt solid ${C.borderLight}`, height: 16 },

  dayNotesRow: { flexDirection: 'row', marginTop: 6 },
  dayNotesCell: { flex: 1, marginRight: 4, border: `0.6pt solid ${C.border}`, padding: 4, minHeight: 38 },
  dayNotesCellLast: { flex: 1, border: `0.6pt solid ${C.border}`, padding: 4, minHeight: 38 },
  dayNotesTitle: { fontSize: 7, color: C.mute, marginBottom: 2 },
  dayNotesRule: { borderBottom: `0.4pt solid ${C.borderLight}`, height: 12 },

  footer: { position: 'absolute', bottom: 16, left: 24, right: 24, flexDirection: 'row', alignItems: 'center' },
  footerQuote: { flex: 1, fontSize: 8, fontStyle: 'italic', color: C.mute },
  weekCheckRow: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  weekCheckBox: { width: 8, height: 8, border: `0.8pt solid ${C.ink}`, marginRight: 3 },
  weekCheckBoxFilled: { width: 8, height: 8, border: `0.8pt solid ${C.ink}`, backgroundColor: C.ink, marginRight: 3 },
  weekCheckLabel: { fontSize: 8, fontWeight: 'bold', color: C.ink, marginRight: 8 },
});

function fmtTime(t?: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${m}${ampm.toLowerCase()}`;
}

/** TPT-style clock: "9:30" — a school day needs no am/pm inside the grid. */
function fmtClock(t?: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const h12 = ((parseInt(h, 10) + 11) % 12) + 1;
  return `${h12}:${m}`;
}

function teacherLast(name?: string | null) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1].toUpperCase();
}

function dedupeSlots(blocks: PlannerBlock[]): { start: string; end: string }[] {
  const map = new Map<string, { start: string; end: string }>();
  for (const b of blocks) {
    const k = `${b.start_time}-${b.end_time}`;
    if (!map.has(k)) map.set(k, { start: b.start_time, end: b.end_time });
  }
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/** Band name for print: custom wizard label → readable key → "All". Raw
 *  auto-generated `band_xxxxxx` keys must never reach paper. */
function bandName(gradeBand: string | null | undefined, bandLabels?: Record<string, string> | null): string {
  const friendly = friendlyBandLabel(gradeBand, bandLabels);
  return friendly || 'All';
}

// ─── Standalone band rows, derived from recess_lunch_config (NOT from slot
// collapse — the old approach dropped the band whenever any day had a class
// starting in the slot, losing the recess info for the other four days). ─────
interface BandRowSpec {
  kind: string;           // left-rail label: "RECESS" / "LUNCH & RECESS"
  sort: string;           // HH:MM the row sorts into the stream by
  text: string;           // "K-2 Recess is 9:30 - 9:45   3-5 Recess is 10:00 - 10:15"
}

function buildBandRows(recess: RecessRow[], bandLabels?: Record<string, string> | null): BandRowSpec[] {
  const rows: BandRowSpec[] = [];
  const window = (s?: string | null, e?: string | null) => `${fmtClock(s)} - ${fmtClock(e)}`;

  // AM recess band.
  const amParts: string[] = [];
  let amMin: string | null = null;
  for (const r of recess) {
    if (!r.am_recess_start || !r.am_recess_end) continue;
    amParts.push(`${bandName(r.grade_band, bandLabels)} Recess is ${window(r.am_recess_start, r.am_recess_end)}`);
    if (!amMin || r.am_recess_start < amMin) amMin = r.am_recess_start;
  }
  if (amParts.length && amMin) {
    rows.push({ kind: 'RECESS', sort: amMin, text: [...new Set(amParts)].join('    ') });
  }

  // Lunch (+ following PM recess) band — her TPT phrasing:
  // "K-2 Lunch is 11:00 - 11:30 w/ recess at 11:30 - 11:45".
  const lunchParts: string[] = [];
  let lunchMin: string | null = null;
  const pmUsed = new Set<RecessRow>();
  for (const r of recess) {
    if (!r.lunch_start || !r.lunch_end) continue;
    let part = `${bandName(r.grade_band, bandLabels)} Lunch is ${window(r.lunch_start, r.lunch_end)}`;
    if (r.pm_recess_start && r.pm_recess_end) {
      part += ` w/ recess at ${window(r.pm_recess_start, r.pm_recess_end)}`;
      pmUsed.add(r);
    }
    lunchParts.push(part);
    if (!lunchMin || r.lunch_start < lunchMin) lunchMin = r.lunch_start;
  }
  if (lunchParts.length && lunchMin) {
    // Explicit break — 60pt rail would hyphenate "RE-CESS" otherwise.
    rows.push({ kind: 'LUNCH &\nRECESS', sort: lunchMin, text: [...new Set(lunchParts)].join('    ') });
  }

  // PM recess without a lunch window on the same band → its own row.
  const pmParts: string[] = [];
  let pmMin: string | null = null;
  for (const r of recess) {
    if (pmUsed.has(r) || !r.pm_recess_start || !r.pm_recess_end) continue;
    pmParts.push(`${bandName(r.grade_band, bandLabels)} PM Recess is ${window(r.pm_recess_start, r.pm_recess_end)}`);
    if (!pmMin || r.pm_recess_start < pmMin) pmMin = r.pm_recess_start;
  }
  if (pmParts.length && pmMin) {
    rows.push({ kind: 'RECESS', sort: pmMin, text: [...new Set(pmParts)].join('    ') });
  }

  return rows;
}

const NOTE_INLINE_MAX = 30;

function renderCellContent(b: PlannerBlock | undefined, noteNumber?: number, striped?: boolean) {
  if (striped) return null; // holiday/PD column — the day-note strip carries the label
  if (!b) return <Text style={styles.openText}>Open</Text>;
  const subj = (b.subject || '').toLowerCase();
  if (subj.includes('planning') || subj.includes('plc')) {
    return <Text style={styles.planningText}>Planning</Text>;
  }
  const grade = formatGradeOrdinal(b.grade);
  const last = teacherLast(b.teacher_name);
  const notes = (b.notes ?? '').trim();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.classText}>{grade ? `${grade} ` : ''}{last}</Text>
      {/* Cells carry their own times — a cut-out cell must stay self-evident. */}
      <Text style={styles.cellTime}>{fmtClock(b.start_time)} - {fmtClock(b.end_time)}</Text>
      {notes ? (
        <Text style={styles.cellNotes}>
          {notes.length > NOTE_INLINE_MAX ? `${notes.slice(0, NOTE_INLINE_MAX)}… (${noteNumber})` : notes}
        </Text>
      ) : null}
    </View>
  );
}

function PlannerPage({
  specialist, blocks, monday, weekLabel, schoolName, schoolYear, recessConfig, bandLabels, includeNotesBox, calendarEvents, schoolHours, quote: quoteProp, anyWeekLabels,
}: {
  specialist: { id: string; name: string; subject: string };
  blocks: PlannerBlock[];
  monday: Date;
  weekLabel?: 'A' | 'B';
  schoolName?: string;
  schoolYear?: string;
  recessConfig: RecessRow[];
  bandLabels?: Record<string, string> | null;
  includeNotesBox?: boolean;
  calendarEvents?: SchoolCalendarEvent[];
  schoolHours?: SchoolHours;
  quote?: string | null;
  /** Schedule uses A/B weeks at all — controls the footer checkboxes. */
  anyWeekLabels: boolean;
}) {
  // Filter to this specialist + this week label
  const mine = blocks.filter((b) => {
    const matchSpec = b.specialist_id === specialist.id || b.specialist_name === specialist.name;
    if (!matchSpec) return false;
    if (weekLabel && b.week_label && b.week_label !== weekLabel) return false;
    return true;
  });
  const slots = dedupeSlots(mine);
  const dayLabels = DAYS.map((_, i) => getDayLabelFor(addDays(monday, i), calendarEvents));
  const quote = (quoteProp && quoteProp.trim()) || pickQuoteForWeek(monday);
  const { accent } = getSubjectColors(specialist.subject);
  const totalSlots = slots.length * 5;
  const isTeaching = (b: PlannerBlock) => {
    const s = (b.subject || '').toLowerCase();
    return !s.includes('planning') && !s.includes('plc') && !s.includes('lunch') && (b.grade || '').toLowerCase() !== 'lunch';
  };
  const filledSlots = mine.filter(isTeaching).length;
  const loadPct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

  // Day notes: holiday/PD/waiver (from the calendar) or early release.
  const erDay = (schoolHours?.earlyReleaseDay ?? '').slice(0, 3);
  const erEnd = schoolHours?.earlyReleaseEnd ?? null;
  const dayNotes = DAYS.map((d, i) => {
    const lbl = dayLabels[i];
    if (lbl) {
      return { special: true, text: lbl.type === 'holiday' ? `HOLIDAY: ${lbl.label}` : lbl.type === 'pd' ? 'PD DAY' : 'WAIVER DAY' };
    }
    if (erDay && erEnd && d === erDay) {
      return { special: false, text: `School Ends ${fmtClock(erEnd)}` };
    }
    return null;
  });
  const hasDayNotes = dayNotes.some(Boolean);

  // Cell lookup matches BOTH start and end — rows are keyed start+end, so a
  // start-only match would render a block on every row sharing its start.
  const blockAt = (day: string, slot: { start: string; end: string }) =>
    mine.find((b) => b.day_of_week === day && b.start_time === slot.start && b.end_time === slot.end);

  // Build numbered footnotes for any block notes that overflow the cell.
  const footnotes: { n: number; day: string; time: string; text: string }[] = [];
  const noteNumberByBlock = new Map<PlannerBlock, number>();
  for (const slot of slots) {
    for (const day of DAYS) {
      const block = blockAt(day, slot);
      const text = (block?.notes ?? '').trim();
      if (block && text && text.length > NOTE_INLINE_MAX) {
        const n = footnotes.length + 1;
        noteNumberByBlock.set(block, n);
        footnotes.push({ n, day, time: fmtTime(slot.start), text });
      }
    }
  }

  // Merge slot rows and config-derived band rows into one time-ordered stream.
  type StreamRow =
    | { kind: 'slot'; sort: string; slot: { start: string; end: string } }
    | { kind: 'band'; sort: string; band: BandRowSpec };
  const stream: StreamRow[] = [
    ...slots.map((slot) => ({ kind: 'slot' as const, sort: slot.start, slot })),
    ...buildBandRows(recessConfig, bandLabels).map((band) => ({ kind: 'band' as const, sort: band.sort, band })),
  ].sort((a, b) => a.sort.localeCompare(b.sort) || (a.kind === 'band' ? -1 : 1));

  // The planner is a ONE-PAGE artifact (like the paper TPT planner it mirrors).
  // On dense weeks the fixed-height tail boxes would spill onto a lonely second
  // page, so shed them by density: Weekly Notes first (the header already has
  // Notes rules), then the per-day notes row.
  const density = stream.length + (footnotes.length > 0 ? 1 : 0);
  const showWeeklyNotes = density <= 8;
  const showDayNotes = !!includeNotesBox && density <= 10;

  return (
    <Page size="LETTER" orientation="landscape" style={styles.page}>
      {/* Header band */}
      <View style={[styles.header, { borderBottomColor: accent }]}>
        <View style={[styles.headerLeft, { flexDirection: 'row', alignItems: 'flex-start' }]}>
          <Image src={LOGO_URL} style={{ width: 28, height: 28, marginRight: 8 }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.subject, { color: accent }]}>{(specialist.subject || specialist.name).toUpperCase()}{specialist.subject ? ' CLASS' : ''}</Text>
            <Text style={[styles.headerMute, { color: C.ink }]}>{specialist.name}</Text>
            <Text style={styles.headerMute}>{schoolName ?? ''}{schoolName && schoolYear ? ' · ' : ''}{schoolYear ?? ''}</Text>
          </View>
        </View>
        <View style={styles.headerCenter}>
          <Text style={styles.weekOf}>{formatWeekHeader(monday)}</Text>
          <View style={styles.checkRow}>
            {['Staff Meeting', 'PD Day', 'Waiver Day', 'Holiday'].map((label) => (
              <View key={label} style={styles.checkItem}>
                <View style={[styles.checkBox, { borderColor: accent }]} />
                <Text style={styles.checkLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.notesLabel}>Notes:</Text>
          <View style={styles.notesLine} />
          <View style={styles.notesLine} />
          <View style={styles.notesLine} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
            <Text style={[styles.loadLabel, { marginTop: 0, marginRight: 4 }]}>Load</Text>
            <View style={{ flex: 1, height: 4, backgroundColor: C.borderLight }}>
              <View style={{ width: `${loadPct}%`, height: 4, backgroundColor: accent }} />
            </View>
            <Text style={{ fontSize: 7, color: C.mute, marginLeft: 4 }}>{filledSlots}/{totalSlots}</Text>
          </View>
        </View>
      </View>

      {/* Grid header */}
      <View style={[styles.gridHeader, { backgroundColor: accent }]}>
        <Text style={[styles.gridHeaderCell, styles.timeColHeader]}>TIME</Text>
        {DAYS.map((d, i) => (
          <Text key={d} style={[styles.gridHeaderCell, styles.dayColHeader]}>
            {formatDayHeader(addDays(monday, i))}
          </Text>
        ))}
      </View>

      {/* Day-note strip: HOLIDAY / PD DAY / WAIVER DAY / "School Ends 1:15" */}
      {hasDayNotes && (
        <View style={styles.dayNoteRow} wrap={false}>
          <View style={styles.dayNoteSpacer} />
          {DAYS.map((d, i) => {
            const note = dayNotes[i];
            return (
              <View key={d} style={[styles.dayNoteCell, note?.special ? { backgroundColor: C.stripe } : {}]}>
                {note ? (
                  <Text style={note.special ? styles.dayNoteText : styles.dayNoteMute}>{note.text}</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {/* Grid body: slot rows + config-derived recess/lunch bands, time-ordered */}
      {slots.length === 0 ? (
        <View style={styles.row}>
          <Text style={[styles.timeCell, { flex: 1, width: undefined }]}>No scheduled blocks for this week.</Text>
        </View>
      ) : (
        stream.map((row, idx) => {
          if (row.kind === 'band') {
            return (
              <View key={`band-${idx}`} style={styles.bandRow} wrap={false}>
                <Text style={styles.bandKind}>{row.band.kind}</Text>
                {/* No duty data model yet — a write-in chip like her paper planner. */}
                <Text style={styles.dutyChip}>DUTY ____ – ____</Text>
                <Text style={styles.bandText}>{row.band.text}</Text>
              </View>
            );
          }
          const { slot } = row;
          const zebra = idx % 2 === 1 ? { backgroundColor: C.zebra } : {};
          return (
            <View key={`slot-${idx}`} style={[styles.row, zebra]} wrap={false}>
              <View style={[styles.timeCell, zebra]}><Text>{fmtClock(slot.start)} - {fmtClock(slot.end)}</Text></View>
              {DAYS.map((day, di) => {
                const striped = !!dayLabels[di];
                const block = striped ? undefined : blockAt(day, slot);
                const n = block ? noteNumberByBlock.get(block) : undefined;
                const isFilled = block && isTeaching(block);
                return (
                  <View
                    key={day}
                    style={[
                      styles.dayCell,
                      isFilled ? { borderTopColor: accent, borderTopWidth: 1.5 } : {},
                      zebra,
                      striped ? { backgroundColor: C.stripe } : {},
                    ]}
                  >
                    {renderCellContent(block, n, striped)}
                  </View>
                );
              })}
            </View>
          );
        })
      )}

      {/* Block notes footnotes (printed from DB) */}
      {footnotes.length > 0 && (
        <View style={styles.footnotesBox} wrap={false}>
          <Text style={styles.footnotesTitle}>Block Notes</Text>
          {footnotes.map((f) => (
            <View key={f.n} style={styles.footnoteRow}>
              <Text style={styles.footnoteDay}>{f.n}. {f.day} {f.time}</Text>
              <Text style={styles.footnoteText}>{f.text}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Per-day handwriting notes (optional; shed on dense weeks) */}
      {showDayNotes && (
        <View style={styles.dayNotesRow} wrap={false}>
          <View style={[{ width: 60 }]} />
          {DAYS.map((d, i) => (
            <View key={d} style={i === DAYS.length - 1 ? styles.dayNotesCellLast : styles.dayNotesCell}>
              <Text style={styles.dayNotesTitle}>Notes</Text>
              <View style={styles.dayNotesRule} />
              <View style={[styles.dayNotesRule, { marginTop: 2 }]} />
            </View>
          ))}
        </View>
      )}

      {/* Weekly Notes (shed on dense weeks — the header keeps its Notes rules) */}
      {showWeeklyNotes && (
        <View style={styles.notesBox} wrap={false}>
          <Text style={styles.notesTitle}>Weekly Notes</Text>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.notesRule, { marginTop: i === 0 ? 4 : 0 }]} />
          ))}
        </View>
      )}

      {/* Footer — quote · "A Week ☐ B Week ☐" · brand + page numbers */}
      <View style={styles.footer} fixed>
        <Text style={styles.footerQuote}>"{quote}"</Text>
        {anyWeekLabels && (
          <View style={styles.weekCheckRow}>
            <View style={weekLabel === 'A' ? styles.weekCheckBoxFilled : styles.weekCheckBox} />
            <Text style={styles.weekCheckLabel}>A Week</Text>
            <View style={weekLabel === 'B' ? styles.weekCheckBoxFilled : styles.weekCheckBox} />
            <Text style={styles.weekCheckLabel}>B Week</Text>
          </View>
        )}
        <Text style={{ fontSize: 7.5, color: C.mute }}>
          {PDF_BRAND.domain} · {PDF_BRAND.name} · <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </Text>
      </View>
    </Page>
  );
}

export const SpecialistPlanner = ({
  specialists, blocks, schoolName, schoolYear, weeks, weekLabels, recessConfig = [], bandLabels, includeNotesBox = true, calendarEvents, schoolHours, quote,
}: SpecialistPlannerProps) => {
  const safeWeeks = weeks && weeks.length > 0 ? weeks : [new Date()];
  const labels = weekLabels && weekLabels.length > 0 ? weekLabels : [undefined];
  const anyWeekLabels = labels.some(Boolean) || blocks.some((b) => !!b.week_label);
  return (
    <Document>
      {specialists.flatMap((s) =>
        safeWeeks.flatMap((monday) =>
          labels.map((wl) => (
            <PlannerPage
              key={`${s.id}-${monday.toISOString()}-${wl || 'x'}`}
              specialist={s}
              blocks={blocks}
              monday={monday}
              weekLabel={wl}
              schoolName={schoolName}
              schoolYear={schoolYear}
              recessConfig={recessConfig}
              bandLabels={bandLabels}
              includeNotesBox={includeNotesBox}
              calendarEvents={calendarEvents}
              schoolHours={schoolHours}
              quote={quote}
              anyWeekLabels={anyWeekLabels}
            />
          ))
        )
      )}
    </Document>
  );
};

export default SpecialistPlanner;
