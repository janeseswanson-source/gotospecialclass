import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { addDays, formatWeekHeader, formatDayHeader } from './lib/weekDates';
import { getDayLabelFor, type SchoolCalendarEvent } from './lib/holidays';
import { pickQuoteForWeek } from './lib/quotes';
import { PDF, PDF_BRAND, pdfSubjectColors } from './lib/pdfTheme';
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

export interface SpecialistPlannerProps {
  specialists: { id: string; name: string; subject: string }[];
  blocks: PlannerBlock[];
  schoolName?: string;
  schoolYear?: string;
  weeks: Date[];
  weekLabels?: (undefined | 'A' | 'B')[]; // one or more; default [undefined]
  recessConfig?: RecessRow[];
  includeNotesBox?: boolean;
  /** Approved school calendar events — drive HOLIDAY/PD overlays. */
  calendarEvents?: SchoolCalendarEvent[];
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
  headerLeft: { width: '35%' },
  headerCenter: { width: '35%', paddingHorizontal: 8 },
  headerRight: { width: '30%' },
  subject: { fontSize: 22, fontWeight: 'bold', letterSpacing: 1 },
  weekOf: { fontSize: 10, color: C.mute, marginTop: 4 },
  checkRow: { flexDirection: 'row', flexWrap: 'wrap' },
  checkItem: { flexDirection: 'row', alignItems: 'center', width: '50%', marginBottom: 4 },
  checkBox: { width: 9, height: 9, border: `0.8pt solid ${C.ink}`, marginRight: 4 },
  checkLabel: { fontSize: 9 },
  notesLabel: { fontSize: 9, fontWeight: 'bold', marginBottom: 6 },
  notesLine: { borderBottom: `0.5pt solid ${C.border}`, height: 12 },

  gridHeader: { flexDirection: 'row', backgroundColor: C.ink, color: C.white },
  gridHeaderCell: { padding: 4, fontSize: 8, fontWeight: 'bold', textAlign: 'center', borderRight: `0.5pt solid ${C.navy}` },
  timeColHeader: { width: 60 },
  dayColHeader: { flex: 1 },

  row: { flexDirection: 'row', borderBottom: `0.5pt solid ${C.borderLight}`, minHeight: 26 },
  timeCell: { width: 60, padding: 3, fontSize: 8, color: C.mute, borderRight: `0.5pt solid ${C.borderLight}`, textAlign: 'center', justifyContent: 'center' },
  dayCell: { flex: 1, padding: 3, fontSize: 8.5, borderRight: `0.5pt solid ${C.borderLight}`, justifyContent: 'center', alignItems: 'center' },
  bandRow: { flexDirection: 'row', backgroundColor: C.band, borderTop: `0.5pt solid ${C.gold}`, borderBottom: `0.5pt solid ${C.gold}`, minHeight: 18 },
  bandText: { flex: 1, padding: 3, fontSize: 8, fontStyle: 'italic', textAlign: 'center', color: C.ink },

  openText: { color: C.open, fontStyle: 'italic' },
  planningText: { color: C.mute, fontStyle: 'italic' },
  classText: { textAlign: 'center' },
  cellNotes: { fontSize: 6.5, fontStyle: 'italic', color: C.mute, textAlign: 'center', marginTop: 1 },
  footnotesBox: { marginTop: 6, padding: 4, border: `0.5pt dashed ${C.gold}` },
  footnotesTitle: { fontSize: 7, fontWeight: 'bold', color: C.ink, marginBottom: 2 },
  footnoteRow: { flexDirection: 'row', marginTop: 1 },
  footnoteDay: { fontSize: 6.5, color: C.mute, width: 36 },
  footnoteText: { fontSize: 6.5, color: C.ink, flex: 1 },

  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(197,165,90,0.18)', justifyContent: 'center', alignItems: 'center' },
  overlayLabel: { fontSize: 8, fontWeight: 'bold', color: C.ink, textAlign: 'center', transform: 'rotate(-20deg)' },

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
  weekPill: { fontSize: 8, fontWeight: 'bold', color: C.ink, border: `0.6pt solid ${C.gold}`, paddingHorizontal: 6, paddingVertical: 2 },
});

function fmtTime(t?: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${m}${ampm.toLowerCase()}`;
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
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function matchesRange(slotStart: string, slotEnd: string, rStart?: string | null, rEnd?: string | null) {
  if (!rStart || !rEnd) return false;
  // overlap
  return slotStart < rEnd && slotEnd > rStart;
}

function recessLine(slot: { start: string; end: string }, recess: RecessRow[]): string | null {
  if (!recess || recess.length === 0) return null;
  const parts: string[] = [];
  for (const r of recess) {
    if (matchesRange(slot.start, slot.end, r.am_recess_start, r.am_recess_end)) {
      parts.push(`${r.grade_band === 'all' ? 'All' : r.grade_band} Recess ${fmtTime(r.am_recess_start)} – ${fmtTime(r.am_recess_end)}`);
    } else if (matchesRange(slot.start, slot.end, r.pm_recess_start, r.pm_recess_end)) {
      parts.push(`${r.grade_band === 'all' ? 'All' : r.grade_band} PM Recess ${fmtTime(r.pm_recess_start)} – ${fmtTime(r.pm_recess_end)}`);
    }
  }
  return parts.length ? parts.join('  ·  ') : null;
}

function lunchLine(slot: { start: string; end: string }, recess: RecessRow[]): string | null {
  if (!recess || recess.length === 0) return null;
  const parts: string[] = [];
  for (const r of recess) {
    if (matchesRange(slot.start, slot.end, r.lunch_start, r.lunch_end)) {
      parts.push(`${r.grade_band === 'all' ? 'All' : r.grade_band} Lunch ${fmtTime(r.lunch_start)} – ${fmtTime(r.lunch_end)}`);
    }
  }
  return parts.length ? parts.join('  ·  ') : null;
}

const NOTE_INLINE_MAX = 30;

function renderCellContent(b: PlannerBlock | undefined, noteNumber?: number) {
  if (!b) return <Text style={styles.openText}>Open</Text>;
  const subj = (b.subject || '').toLowerCase();
  if (subj.includes('planning') || subj.includes('plc')) {
    return <Text style={styles.planningText}>Planning</Text>;
  }
  const grade = b.grade || '';
  const last = teacherLast(b.teacher_name);
  const notes = (b.notes ?? '').trim();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.classText}>{grade ? `${grade} ` : ''}{last}</Text>
      {notes ? (
        <Text style={styles.cellNotes}>
          {notes.length > NOTE_INLINE_MAX ? `${notes.slice(0, NOTE_INLINE_MAX)}… (${noteNumber})` : notes}
        </Text>
      ) : null}
    </View>
  );
}

function PlannerPage({
  specialist, blocks, monday, weekLabel, schoolName, schoolYear, recessConfig, includeNotesBox, calendarEvents, quote: quoteProp,
}: {
  specialist: { id: string; name: string; subject: string };
  blocks: PlannerBlock[];
  monday: Date;
  weekLabel?: 'A' | 'B';
  schoolName?: string;
  schoolYear?: string;
  recessConfig: RecessRow[];
  includeNotesBox?: boolean;
  calendarEvents?: SchoolCalendarEvent[];
  quote?: string | null;
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
  const filledSlots = mine.filter((b) => {
    const s = (b.subject || '').toLowerCase();
    return !s.includes('planning') && !s.includes('plc') && !s.includes('lunch') && (b.grade || '').toLowerCase() !== 'lunch';
  }).length;
  const loadPct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

  // Build numbered footnotes for any block notes that overflow the cell.
  const footnotes: { n: number; day: string; time: string; text: string }[] = [];
  const noteNumberByBlock = new Map<PlannerBlock, number>();
  for (const slot of slots) {
    for (const day of DAYS) {
      const block = mine.find((b) => b.day_of_week === day && b.start_time === slot.start);
      const text = (block?.notes ?? '').trim();
      if (block && text && text.length > NOTE_INLINE_MAX) {
        const n = footnotes.length + 1;
        noteNumberByBlock.set(block, n);
        footnotes.push({ n, day, time: fmtTime(slot.start), text });
      }
    }
  }

  return (
    <Page size="LETTER" orientation="landscape" style={styles.page}>
      {/* Header band */}
      <View style={[styles.header, { borderBottomColor: accent }]}>
        <View style={[styles.headerLeft, { flexDirection: 'row', alignItems: 'flex-start' }]}>
          <Image src={LOGO_URL} style={{ width: 28, height: 28, marginRight: 8 }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.subject, { color: accent }]}>{(specialist.subject || specialist.name).toUpperCase()}{specialist.subject ? ' CLASS' : ''}</Text>
            <Text style={styles.weekOf}>{formatWeekHeader(monday)}{schoolName ? ` · ${schoolName}` : ''}</Text>
            {schoolYear && <Text style={[styles.weekOf, { marginTop: 1 }]}>{schoolYear}</Text>}
            <Text style={[styles.weekOf, { marginTop: 2 }]}>{specialist.name}</Text>
          </View>
        </View>
        <View style={styles.headerCenter}>
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
          <Text style={[styles.notesLabel, { color: C.mute, fontSize: 7 }]}>Teaching Load This Week</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            <View style={{ flex: 1, height: 5, backgroundColor: C.borderLight }}>
              <View style={{ width: `${loadPct}%`, height: 5, backgroundColor: accent }} />
            </View>
            <Text style={{ fontSize: 7.5, color: C.mute, marginLeft: 5 }}>{filledSlots}/{totalSlots}</Text>
          </View>
          <Text style={[styles.notesLabel, { marginTop: 8 }]}>Notes:</Text>
          <View style={styles.notesLine} />
          <View style={[styles.notesLine, { marginTop: 6 }]} />
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

      {/* Grid body */}
      {slots.length === 0 ? (
        <View style={styles.row}>
          <Text style={[styles.timeCell, { flex: 1, width: undefined }]}>No scheduled blocks for this week.</Text>
        </View>
      ) : (
        slots.map((slot, idx) => {
          const rLine = recessLine(slot, recessConfig);
          const lLine = lunchLine(slot, recessConfig);
          // Only collapse the row into a recess/lunch band when the specialist
          // has NO real classes in this slot — a class can legitimately overlap
          // another grade band's recess and must never disappear from print.
          const slotBlocks = mine.filter((b) => b.start_time === slot.start);
          const hasRealClass = slotBlocks.some((b) => {
            const s = (b.subject || '').toLowerCase();
            return !s.includes('planning') && !s.includes('plc') && !s.includes('lunch') && (b.grade || '').toLowerCase() !== 'lunch';
          });
          if ((rLine || lLine) && !hasRealClass) {
            return (
              <View key={idx} style={styles.bandRow}>
                <View style={styles.timeCell}><Text>{fmtTime(slot.start)} – {fmtTime(slot.end)}</Text></View>
                <Text style={styles.bandText}>{rLine || lLine}</Text>
              </View>
            );
          }
          return (
            <View key={idx} style={[styles.row, idx % 2 === 1 ? { backgroundColor: C.zebra } : {}]}>
              <View style={[styles.timeCell, idx % 2 === 1 ? { backgroundColor: C.zebra } : {}]}><Text>{fmtTime(slot.start)} – {fmtTime(slot.end)}</Text></View>
              {DAYS.map((day) => {
                const block = mine.find((b) => b.day_of_week === day && b.start_time === slot.start);
                const n = block ? noteNumberByBlock.get(block) : undefined;
                const isFilled = block && !(block.subject || '').toLowerCase().includes('planning') && !(block.subject || '').toLowerCase().includes('plc');
                return (
                  <View key={day} style={[styles.dayCell, isFilled ? { borderTopColor: accent, borderTopWidth: 1.5 } : {}, idx % 2 === 1 ? { backgroundColor: C.zebra } : {}]}>
                    {renderCellContent(block, n)}
                  </View>
                );
              })}
            </View>
          );
        })
      )}

      {/* Special day overlays (absolutely positioned per column) */}

      {dayLabels.map((lbl, i) => {
        if (!lbl) return null;
        try {
          // Column position: header is 35%+35%+30% horizontally for top band; but grid is 60pt time + 5 equal day cells across page width minus padding
          // We approximate using percentages of the page content area.
          const pageInnerWidth = 11 * 72 - 24 * 2; // letter landscape 11in - 2*24pt padding
          const timeW = 60;
          const dayW = (pageInnerWidth - timeW) / 5;
          const left = 24 + timeW + i * dayW;
          return (
            <View
              key={`ov-${i}`}
              style={{
                position: 'absolute',
                left,
                top: 90,
                width: dayW,
                bottom: 160,
                backgroundColor: C.stripe,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={styles.overlayLabel}>
                {lbl.type === 'holiday' ? `HOLIDAY: ${lbl.label}` : lbl.type === 'pd' ? 'PD DAY' : 'WAIVER DAY'}
              </Text>
            </View>
          );
        } catch {
          return null;
        }
      })}

      {/* Block notes footnotes (printed from DB) */}
      {footnotes.length > 0 && (
        <View style={styles.footnotesBox}>
          <Text style={styles.footnotesTitle}>Block Notes</Text>
          {footnotes.map((f) => (
            <View key={f.n} style={styles.footnoteRow}>
              <Text style={styles.footnoteDay}>{f.n}. {f.day} {f.time}</Text>
              <Text style={styles.footnoteText}>{f.text}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Per-day handwriting notes (optional) */}
      {includeNotesBox && (
        <View style={styles.dayNotesRow}>
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

      {/* Weekly Notes */}
      <View style={styles.notesBox}>
        <Text style={styles.notesTitle}>Weekly Notes</Text>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.notesRule, { marginTop: i === 0 ? 4 : 0 }]} />
        ))}
      </View>

      {/* Footer — shared anatomy: quote (center) · week pill · brand + page numbers */}
      <View style={styles.footer} fixed>
        <Text style={styles.footerQuote}>"{quote}"</Text>
        {weekLabel && <Text style={[styles.weekPill, { marginRight: 8 }]}>{weekLabel} WEEK</Text>}
        <Text style={{ fontSize: 7.5, color: C.mute }}>
          {PDF_BRAND.domain} · {PDF_BRAND.name} · <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </Text>
      </View>
    </Page>
  );
}

export const SpecialistPlanner = ({
  specialists, blocks, schoolName, schoolYear, weeks, weekLabels, recessConfig = [], includeNotesBox = true, calendarEvents,
}: SpecialistPlannerProps) => {
  const safeWeeks = weeks && weeks.length > 0 ? weeks : [new Date()];
  const labels = weekLabels && weekLabels.length > 0 ? weekLabels : [undefined];
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
              includeNotesBox={includeNotesBox}
              calendarEvents={calendarEvents}
            />
          ))
        )
      )}
    </Document>
  );
};

export default SpecialistPlanner;

