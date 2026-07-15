import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { abbrevSubject, lastName } from './lib/subjectAbbrev';
import { generateSessionRanges } from './lib/sessionCalendar';
import { PDF, PDF_BRAND, pdfSubjectColors } from './lib/pdfTheme';
import { gradeRank, formatGradeOrdinal } from '@/lib/gradeOrdinal';
import logoAsset from '@/assets/logo.png.asset.json';

const LOGO_URL = (() => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(logoAsset.url, window.location.origin).toString();
  }
  return logoAsset.url;
})();

export interface Teacher {
  id: string;
  name: string;
  grade?: string;
  combo_partner_id?: string | null;
}

export interface Club {
  id: string;
  name: string;
  day_of_week?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  grades?: string | null;
  lead_specialist_id?: string | null;
  sessions?: any;
}

export interface AdminOverviewProps {
  specialists: { id: string; name: string; subject: string }[];
  blocks: any[];
  teachers?: Teacher[];
  clubs?: Club[];
  recessConfig?: any[];
  schoolName?: string;
  schoolYear?: string;
  quote?: string | null;
}

const DAYS: { key: string; label: string }[] = [
  { key: 'Mon', label: 'Monday' },
  { key: 'Tue', label: 'Tuesday' },
  { key: 'Wed', label: 'Wednesday' },
  { key: 'Thu', label: 'Thursday' },
  { key: 'Fri', label: 'Friday' },
];

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 42, paddingHorizontal: 24, fontSize: 8, fontFamily: PDF.font },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: `1.5pt solid ${PDF.gold}` },
  headerLogo: { width: 26, height: 26, marginRight: 8 },
  headerTitleBlock: { flex: 1 },
  headerTitle: { fontSize: 12, fontFamily: PDF.fontBold, color: PDF.ink },
  headerSubtitle: { fontSize: 7, color: PDF.mute, letterSpacing: 1, textTransform: 'uppercase', marginTop: 1 },
  headerPage: { fontSize: 8, color: PDF.mute },
  brandFooter: { position: 'absolute', left: 24, right: 24, bottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTop: `0.8pt solid ${PDF.gold}`, paddingTop: 4, fontSize: 7.5, color: PDF.ink },
  brandFooterMute: { color: PDF.mute, fontStyle: 'italic', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  table: { borderTop: `1pt solid ${PDF.ink}`, borderLeft: `1pt solid ${PDF.ink}` },
  colHeader: { flexDirection: 'row', backgroundColor: PDF.ink },
  colHeaderCell: { padding: 4, fontSize: 8, fontFamily: PDF.fontBold, color: PDF.white, borderRight: `1pt solid ${PDF.white}`, textAlign: 'center' },
  row: { flexDirection: 'row', borderBottom: `1pt solid ${PDF.ink}`, minHeight: 36 },
  cell: { padding: 3, borderRight: `1pt solid ${PDF.ink}`, fontSize: 7 },
  timeCell: { padding: 3, borderRight: `1pt solid ${PDF.ink}`, fontSize: 7, fontFamily: PDF.fontBold, backgroundColor: PDF.cream, justifyContent: 'center', alignItems: 'center', textAlign: 'center' },
  bandRow: { flexDirection: 'row', borderBottom: `1pt solid ${PDF.ink}`, backgroundColor: PDF.cream, minHeight: 18 },
  bandCell: { padding: 4, fontSize: 8, fontFamily: PDF.fontBold, color: PDF.ink, textAlign: 'center', justifyContent: 'center' },
  subHeader: { fontSize: 6, fontFamily: PDF.fontBold, color: PDF.gold, marginBottom: 1 },
  gradeHeader: { fontSize: 7.5, fontFamily: PDF.fontBold, color: PDF.ink, marginBottom: 1 },
  entry: { fontSize: 7, marginBottom: 1, marginLeft: 4 },
  footnote: { marginTop: 8, fontSize: 7, color: PDF.mute, fontStyle: 'italic' },
  legendPage: { paddingTop: 28, paddingBottom: 42, paddingHorizontal: 36, fontSize: 10, fontFamily: PDF.font },
  legendTitle: { fontSize: 16, fontFamily: PDF.fontBold, color: PDF.ink, marginBottom: 12 },
  legendGroup: { marginBottom: 8 },
  legendSubject: { fontSize: 11, fontFamily: PDF.fontBold, color: PDF.gold, marginBottom: 3 },
  legendItem: { fontSize: 9, marginLeft: 12, marginBottom: 2 },
  sessionItem: { fontSize: 6.5, marginBottom: 2 },
});

// Subject accent from the shared brand band (same hue as grid + xlsx + planner).
function getSubjectColor(subject?: string): string {
  if (!subject) return PDF.ink;
  return pdfSubjectColors(subject).accent;
}

function uniqueTimeSlots(blocks: any[]): { start: string; end: string }[] {
  const seen = new Map<string, { start: string; end: string }>();
  for (const b of blocks) {
    if (!b.start_time || !b.end_time) continue;
    const key = `${b.start_time}-${b.end_time}`;
    if (!seen.has(key)) seen.set(key, { start: b.start_time, end: b.end_time });
  }
  return Array.from(seen.values()).sort((a, b) => a.start.localeCompare(b.start));
}

function fmtTime(t?: string): string {
  if (!t) return '';
  const [hh, mm] = t.split(':');
  const h = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hr = ((h + 11) % 12) + 1;
  return m === 0 ? `${hr}${ampm}` : `${hr}:${mm}${ampm}`;
}

interface RotationLine {
  grade: string;
  subjectAbbrev: string;
  subjectFull: string;
  teacherDisplay: string;
  isCombo: boolean;
}

function buildLine(block: any, specialistsById: Map<string, any>, teachersById: Map<string, Teacher>): RotationLine {
  const spec = block.specialist_id ? specialistsById.get(block.specialist_id) : null;
  const teacher = block.teacher_id ? teachersById.get(block.teacher_id) : null;
  const partner = teacher?.combo_partner_id ? teachersById.get(teacher.combo_partner_id) : null;
  const teacherStr = teacher
    ? (partner ? `${lastName(teacher.name)} + ${lastName(partner.name)}` : lastName(teacher.name))
    : (block.teacher_name ? lastName(block.teacher_name) : (spec ? lastName(spec.name) : '—'));
  return {
    grade: block.grade || '',
    subjectAbbrev: abbrevSubject(spec?.subject || block.subject),
    subjectFull: spec?.subject || block.subject || '',
    teacherDisplay: teacherStr,
    isCombo: !!partner,
  };
}

type GradeBlock = { grade?: string | null; [k: string]: unknown };

/** Grade-sorted runs so a slot reads as a wheel: "1st" once, entries under it. */
function groupByGrade(list: GradeBlock[]): { grade: string; items: GradeBlock[] }[] {
  const sorted = [...list].sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade));
  const groups: { grade: string; items: GradeBlock[] }[] = [];
  for (const b of sorted) {
    const g = b.grade || '';
    const last = groups[groups.length - 1];
    if (last && last.grade === g) last.items.push(b);
    else groups.push({ grade: g, items: [b] });
  }
  return groups;
}

function renderGradeGrouped(
  list: GradeBlock[],
  keyPrefix: string,
  specialistsById: Map<string, unknown>,
  teachersById: Map<string, Teacher>,
) {
  return groupByGrade(list).map((grp, gi) => (
    <View key={`${keyPrefix}-g${gi}`}>
      {grp.grade ? <Text style={styles.gradeHeader}>{formatGradeOrdinal(grp.grade)}</Text> : null}
      {grp.items.map((bk, i) => {
        const line = buildLine(bk, specialistsById, teachersById);
        return (
          <Text key={`${keyPrefix}-g${gi}-${i}`} style={styles.entry}>
            <Text style={{ color: getSubjectColor(line.subjectFull) }}>{line.subjectAbbrev}</Text>
            {` (${line.teacherDisplay})`}{line.isCombo ? '*' : ''}
          </Text>
        );
      })}
    </View>
  ));
}

function renderCellEntries(
  cellBlocks: any[],
  specialistsById: Map<string, any>,
  teachersById: Map<string, Teacher>,
  hasABInSlot: boolean,
) {
  if (cellBlocks.length === 0) return null;

  if (hasABInSlot) {
    const a = cellBlocks.filter((b) => b.week_label === 'A' || !b.week_label);
    const b = cellBlocks.filter((bb) => bb.week_label === 'B');
    return (
      <>
        {a.length > 0 && (
          <View>
            <Text style={styles.subHeader}>SESSION A</Text>
            {renderGradeGrouped(a, 'a', specialistsById, teachersById)}
          </View>
        )}
        {b.length > 0 && (
          <View style={{ marginTop: 2 }}>
            <Text style={styles.subHeader}>SESSION B</Text>
            {renderGradeGrouped(b, 'b', specialistsById, teachersById)}
          </View>
        )}
      </>
    );
  }

  return <>{renderGradeGrouped(cellBlocks, 'p', specialistsById, teachersById)}</>;
}

export const AdminOverview = ({
  specialists,
  blocks,
  teachers = [],
  clubs = [],
  recessConfig = [],
  schoolName,
  schoolYear,
  quote,
}: AdminOverviewProps) => {
  const specialistsById = new Map(specialists.map((s) => [s.id, s]));
  const teachersById = new Map(teachers.map((t) => [t.id, t]));

  const hasAB = blocks.some((b) => b.week_label === 'A' || b.week_label === 'B');
  const timeSlots = uniqueTimeSlots(blocks);
  const hasCombo = teachers.some((t) => !!t.combo_partner_id);

  const sessionRanges = hasAB ? generateSessionRanges(schoolYear) : [];
  const sessionA = sessionRanges.filter((r) => r.label === 'A');
  const sessionB = sessionRanges.filter((r) => r.label === 'B');

  // Column widths (percentages must sum to 100)
  const timeColW = 8;
  const dayColW = (100 - timeColW) / 5;

  // Recess / lunch windows from EVERY config row (staggered schools have one
  // row per grade band — using only the first row showed the wrong band's
  // times and could hide real classes).
  const recessStarts = new Map<string, string>(); // start -> end
  const lunchStarts = new Map<string, string>();
  for (const rc of recessConfig) {
    if (rc?.am_recess_start && rc?.am_recess_end) recessStarts.set(rc.am_recess_start, rc.am_recess_end);
    if (rc?.pm_recess_start && rc?.pm_recess_end) recessStarts.set(rc.pm_recess_start, rc.pm_recess_end);
    if (rc?.lunch_start && rc?.lunch_end) lunchStarts.set(rc.lunch_start, rc.lunch_end);
  }

  const isRealClass = (b: any) => {
    const s = (b.subject || '').toLowerCase();
    return b.specialist_id && !s.includes('lunch') && !s.includes('planning') && !s.includes('plc') && (b.grade || '').toLowerCase() !== 'lunch';
  };

  const headerTitle = `Master Schedule — ${schoolName || 'School'}${schoolYear ? ` — ${schoolYear}` : ''}`;

  // Group clubs by lead specialist subject
  const clubsBySubject: Record<string, string[]> = {};
  for (const c of clubs) {
    const lead = c.lead_specialist_id ? specialistsById.get(c.lead_specialist_id) : null;
    const subj = lead?.subject || 'Other';
    if (!clubsBySubject[subj]) clubsBySubject[subj] = [];
    if (!clubsBySubject[subj].includes(c.name)) clubsBySubject[subj].push(c.name);
  }

  // Lunch club label per day
  function lunchLabelForDay(day: string): string {
    const dayClubs = clubs.filter((c) => {
      if (c.day_of_week === day) return true;
      const sess = Array.isArray(c.sessions) ? c.sessions : [];
      return sess.some((s: any) => s?.day === day);
    });
    if (dayClubs.length === 0) return 'No Lunch Clubs';
    const names = dayClubs.map((c) => c.name).slice(0, 2).join(', ');
    return dayClubs.length > 2 ? `${names} +${dayClubs.length - 2}` : names;
  }

  // A slot collapses into a band row ONLY when no real class starts there —
  // classes overlapping another band's recess/lunch must stay visible.
  function hasRealClassAt(start: string): boolean {
    return blocks.some((b) => b.start_time === start && isRealClass(b));
  }
  function isRecessTime(start: string): boolean {
    return recessStarts.has(start) && !hasRealClassAt(start);
  }
  function isLunchTime(start: string): boolean {
    return lunchStarts.has(start) && !hasRealClassAt(start);
  }

  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.headerRow} fixed>
          <Image src={LOGO_URL} style={styles.headerLogo} />
          <View style={styles.headerTitleBlock}>
            <Text style={styles.headerTitle}>{headerTitle}</Text>
            <Text style={styles.headerSubtitle}>Master Admin Overview · Specialist Ops!</Text>
          </View>
          <Text
            style={styles.headerPage}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>

        <View style={styles.table}>
          {/* Column headers */}
          <View style={styles.colHeader} fixed>
            <Text style={[styles.colHeaderCell, { width: `${timeColW}%` }]}>Time</Text>
            {DAYS.map((d) => (
              <Text key={d.key} style={[styles.colHeaderCell, { width: `${dayColW}%` }]}>{d.label}</Text>
            ))}
          </View>

          {timeSlots.length === 0 && (
            <View style={styles.row}>
              <Text style={[styles.cell, { width: '100%' }]}>No schedule blocks to display.</Text>
            </View>
          )}

          {timeSlots.map((slot, slotIdx) => {
            // Band row (recess / lunch) only when no real class starts here
            if (isRecessTime(slot.start)) {
              const end = recessStarts.get(slot.start);
              return (
                <View key={`band-r-${slotIdx}`} style={styles.bandRow} wrap={false}>
                  <View style={[styles.bandCell, { width: '100%' }]}>
                    <Text>{fmtTime(slot.start)}–{fmtTime(end)} · RECESS</Text>
                  </View>
                </View>
              );
            }
            if (isLunchTime(slot.start)) {
              return (
                <View key={`band-l-${slotIdx}`} style={styles.bandRow} wrap={false}>
                  <View style={[styles.timeCell, { width: `${timeColW}%`, backgroundColor: PDF.cream }]}>
                    <Text>{fmtTime(slot.start)}–{fmtTime(lunchStarts.get(slot.start))}</Text>
                  </View>
                  {DAYS.map((d) => (
                    <View key={d.key} style={[styles.cell, { width: `${dayColW}%`, justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 7, textAlign: 'center', fontFamily: PDF.fontBold }}>
                        {lunchLabelForDay(d.key)}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            }

            return (
              <View key={`row-${slotIdx}`} style={[styles.row, slotIdx % 2 === 1 ? { backgroundColor: PDF.zebra } : {}]} wrap={false}>
                <View style={[styles.timeCell, { width: `${timeColW}%` }, slotIdx % 2 === 1 ? { backgroundColor: PDF.cream } : {}]}>
                  <Text>{fmtTime(slot.start)}</Text>
                  <Text>{fmtTime(slot.end)}</Text>
                </View>
                {DAYS.map((d) => {
                  const cellBlocks = blocks.filter(
                    (b) => b.day_of_week === d.key && b.start_time === slot.start,
                  );
                  const slotHasAB =
                    hasAB &&
                    cellBlocks.some((b) => b.week_label === 'A') &&
                    cellBlocks.some((b) => b.week_label === 'B');
                  return (
                    <View key={d.key} style={[styles.cell, { width: `${dayColW}%` }]}>
                      {renderCellEntries(cellBlocks, specialistsById, teachersById, slotHasAB)}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>

        {hasCombo && (
          <Text style={styles.footnote} fixed>
            * Combo class — two grades or sections together.
          </Text>
        )}

        <View style={styles.brandFooter} fixed>
          <Text>{PDF_BRAND.domain}</Text>
          <Text style={styles.brandFooterMute}>{quote?.trim() ? `"${quote.trim()}"` : PDF_BRAND.footerTag}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {/* Lunch clubs legend page */}
      <Page size="LETTER" orientation="landscape" style={styles.legendPage}>
        <View style={styles.headerRow} fixed>
          <Image src={LOGO_URL} style={styles.headerLogo} />
          <View style={styles.headerTitleBlock}>
            <Text style={styles.headerTitle}>{headerTitle}</Text>
            <Text style={styles.headerSubtitle}>Lunch Clubs & Session Calendar</Text>
          </View>
          <Text
            style={styles.headerPage}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
        <Text style={styles.legendTitle}>Lunch Clubs</Text>
        {clubs.length === 0 ? (
          <Text style={{ fontSize: 10, color: PDF.mute }}>No lunch clubs configured.</Text>
        ) : (
          Object.entries(clubsBySubject).map(([subj, names]) => (
            <View key={subj} style={styles.legendGroup}>
              <Text style={styles.legendSubject}>{subj}</Text>
              {names.map((n, i) => (
                <Text key={i} style={styles.legendItem}>• {n}</Text>
              ))}
            </View>
          ))
        )}

        {sessionRanges.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.legendTitle}>2-Week Session Calendar</Text>
            <View style={{ flexDirection: 'row', gap: 32 }}>
              <View>
                <Text style={styles.legendSubject}>Session A Weeks</Text>
                {sessionA.map((r, i) => (
                  <Text key={i} style={styles.legendItem}>{r.text}</Text>
                ))}
              </View>
              <View>
                <Text style={styles.legendSubject}>Session B Weeks</Text>
                {sessionB.map((r, i) => (
                  <Text key={i} style={styles.legendItem}>{r.text}</Text>
                ))}
              </View>
            </View>
          </View>
        )}

        <View style={styles.brandFooter} fixed>
          <Text>{PDF_BRAND.domain}</Text>
          <Text style={styles.brandFooterMute}>{quote?.trim() ? `"${quote.trim()}"` : PDF_BRAND.footerTag}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
};

export default AdminOverview;
