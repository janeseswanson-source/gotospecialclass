// Dev-only: render the Specialist Planner PDF with a realistic fixture so the
// TPT-style layout can be eyeballed without booting the app or hitting Supabase.
//
//   npx vite-node scripts/preview-planner-pdf.tsx
//
// Writes _debug/planner-preview.pdf (standard week + A/B week variants,
// staggered K-2 / 3-5 recess bands, early-release Wednesday, holiday Friday,
// a duplicate-start slot, and an overflow note → footnote).

import fs from 'node:fs';
import path from 'node:path';

// The component resolves its logo against window.location.origin and fetches
// it at render time; serve the local file for any logo request in Node.
(globalThis as any).window ??= { location: { origin: 'https://preview.local' } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (typeof url === 'string' && /logo\.png/.test(url)) {
    const buf = await fs.promises.readFile(path.resolve('src/assets/logo.png'));
    return new Response(buf, { status: 200, headers: { 'Content-Type': 'image/png' } });
  }
  return realFetch(input as any, init);
}) as typeof fetch;

const { renderToBuffer } = await import('@react-pdf/renderer');
const { SpecialistPlanner } = await import('../src/pdf/SpecialistPlanner');
const { getMondayOf } = await import('../src/pdf/lib/weekDates');

const monday = getMondayOf(new Date());
const iso = (offset: number) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const specialists = [
  { id: 'art', name: 'Jane Swanson', subject: 'Art' },
  { id: 'tech', name: 'Pat Grace', subject: 'Technology' },
];

// Jane's TPT reference shape: planning first thing, grade-run mornings,
// staggered lunch, one duplicate-start slot (Tue 8:05-8:35 vs 8:05-8:45)
// and one overflow note.
const art = (day: string, start: string, end: string, grade: string, teacher: string, extra: Partial<any> = {}) => ({
  day_of_week: day, start_time: start, end_time: end, subject: 'Art',
  specialist_id: 'art', specialist_name: 'Jane Swanson',
  teacher_name: teacher, grade, ...extra,
});
const blocks = [
  ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => art(d, '07:45', '08:00', 'Planning', '', { subject: 'Planning' })),
  art('Mon', '08:05', '08:45', '1', 'Ann Scott'),
  art('Mon', '08:50', '09:30', '1', 'Beth Cherry', { notes: 'Bring drying rack for the clay projects today' }),
  art('Mon', '10:00', '10:45', '1', 'Cara Markulis'),
  art('Mon', '10:50', '11:30', '3', 'Dee Stewart'),
  art('Mon', '12:30', '13:10', '3', 'Rob Lee'),
  art('Mon', '13:15', '13:55', '3', 'Kai Nishijima'),
  art('Tue', '08:05', '08:35', 'K', 'Lea Jones'),   // duplicate-start, different end
  art('Tue', '08:05', '08:45', '2', 'Sam Soriano'), // must NOT bleed into the K row
  art('Tue', '10:50', '11:30', '4', 'Kim Lee', { notes: 'iPads' }),
  art('Wed', '08:50', '09:30', '2', 'Wil Willie'),
  art('Thu', '08:05', '08:45', '5', 'Cy Carsten'),
  art('Thu', '12:30', '13:10', '5', 'Pia Paulino'),
  // Tech teacher pages prove multi-specialist output.
  { day_of_week: 'Mon', start_time: '08:05', end_time: '08:45', subject: 'Technology', specialist_id: 'tech', specialist_name: 'Pat Grace', teacher_name: 'Ann Scott', grade: '1' },
];

const recessConfig = [
  { grade_band: 'band_a1b2c3', am_recess_start: '09:30', am_recess_end: '09:45', lunch_start: '11:00', lunch_end: '11:30', pm_recess_start: '11:30', pm_recess_end: '11:45' },
  { grade_band: 'band_d4e5f6', am_recess_start: '10:00', am_recess_end: '10:15', lunch_start: '11:40', lunch_end: '12:10', pm_recess_start: '12:10', pm_recess_end: '12:45' },
];
const bandLabels = { band_a1b2c3: 'K-2', band_d4e5f6: '3-5' };

const calendarEvents = [
  { event_date: iso(4), end_date: iso(4), title: 'Statehood Day', event_type: 'holiday' },
];

const schoolHours = { start: '07:45', end: '14:00', earlyReleaseDay: 'Wed', earlyReleaseEnd: '13:15' };

async function main() {
  fs.mkdirSync('_debug', { recursive: true });

  // Variant 1: standard week.
  const std = await renderToBuffer(
    <SpecialistPlanner
      specialists={specialists}
      blocks={blocks}
      schoolName="Kula Kaiapuni O Maui"
      schoolYear="2026–2027"
      weeks={[monday]}
      recessConfig={recessConfig}
      bandLabels={bandLabels}
      calendarEvents={calendarEvents}
      schoolHours={schoolHours}
      quote="Creativity takes courage."
    />,
  );
  fs.writeFileSync('_debug/planner-preview.pdf', std);
  console.log(`wrote _debug/planner-preview.pdf (${(std.length / 1024).toFixed(0)} KB)`);

  // Variant 2: A/B week (adds week labels + footer checkboxes), no recess data.
  const abBlocks = blocks.map((b, i) => ({ ...b, week_label: b.subject === 'Planning' ? null : (i % 2 ? 'B' : 'A') }));
  const ab = await renderToBuffer(
    <SpecialistPlanner
      specialists={[specialists[0]]}
      blocks={abBlocks}
      schoolName="Kula Kaiapuni O Maui"
      schoolYear="2026–2027"
      weeks={[monday]}
      weekLabels={['A', 'B']}
      recessConfig={[]}
      calendarEvents={[]}
      schoolHours={schoolHours}
    />,
  );
  fs.writeFileSync('_debug/planner-preview-ab.pdf', ab);
  console.log(`wrote _debug/planner-preview-ab.pdf (${(ab.length / 1024).toFixed(0)} KB)`);
}

await main();
