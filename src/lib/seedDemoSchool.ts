import { supabase } from '@/integrations/supabase/client';

const inFlight = new Set<string>();
const log = (...args: any[]) => console.error('[SeedDemo]', ...args);

export type DemoConflictKind =
  | 'ab_week'
  | 'lunch_clubs'
  | 'part_time_specialists'
  | 'two_school_specialists'
  | 'early_release'
  | 'admin_rotation'
  | 'cart_specialists'
  | 'limited_specialist_supply';

export interface SeedDemoOptions {
  teachersPerGrade?: number;
  specialistCount?: number;
  gradesServed?: string[];
  conflicts?: DemoConflictKind[];
  schoolStart?: string;
  schoolEnd?: string;
}

export const DEMO_CONFLICT_LABELS: Record<DemoConflictKind, string> = {
  ab_week: 'A/B Week rotation',
  lunch_clubs: 'Lunch clubs',
  part_time_specialists: 'Part-time specialists',
  two_school_specialists: 'Specialists working at two schools',
  early_release: 'Early release day',
  admin_rotation: 'Admin / PLC rotation blocks',
  cart_specialists: 'Cart-based specialists (no fixed room)',
  limited_specialist_supply: 'Limited specialist supply (triggers "no sessions" warnings)',
};

const ALL_SPECIALIST_TEMPLATES: Array<{ name: string; subject: string; location: string }> = [
  { name: 'Sarah Mendoza', subject: 'Art', location: 'Room 204' },
  { name: 'Mike Patel', subject: 'PE', location: 'Gym' },
  { name: 'Dana Okafor', subject: 'Music', location: 'Room 110' },
  { name: 'Tess Brennan', subject: 'Tech', location: 'Lab 3' },
  { name: 'Lin Harper', subject: 'Library', location: 'Library' },
  { name: 'Alex Romano', subject: 'Science', location: 'Lab 1' },
  { name: 'Priya Shah', subject: 'Drama', location: 'Stage' },
  { name: 'Jordan Wells', subject: 'STEM', location: 'Maker Space' },
  { name: 'Maria Cruz', subject: 'Spanish', location: 'Room 205' },
  { name: 'Sam Cohen', subject: 'Counseling', location: 'Office 2' },
];

export async function deleteSchoolsCascade(schoolIds: string[]) {
  if (schoolIds.length === 0) return;
  const { data: gens } = await supabase
    .from('schedule_generations').select('id').in('school_id', schoolIds);
  const genIds = (gens ?? []).map(g => g.id);
  if (genIds.length > 0) {
    await supabase.from('schedule_blocks').delete().in('generation_id', genIds);
  }
  await supabase.from('schedule_generations').delete().in('school_id', schoolIds);
  await supabase.from('export_records').delete().in('school_id', schoolIds);
  await supabase.from('parsed_calendar_events').delete().in('school_id', schoolIds);
  await supabase.from('calendar_uploads').delete().in('school_id', schoolIds);
  await supabase.from('classroom_teachers').delete().in('school_id', schoolIds);
  await supabase.from('specialists').delete().in('school_id', schoolIds);
  await supabase.from('clubs').delete().in('school_id', schoolIds);
  await supabase.from('special_events').delete().in('school_id', schoolIds);
  await supabase.from('recess_lunch_config').delete().in('school_id', schoolIds);
  const { error } = await supabase.from('schools').delete().in('id', schoolIds);
  if (error) throw error;
}

export async function wipeDemoSchools(workspaceId: string): Promise<number> {
  const { data: rows, error } = await supabase
    .from('schools')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_demo', true);
  if (error) throw error;
  const ids = (rows ?? []).map(r => r.id);
  await deleteSchoolsCascade(ids);
  return ids.length;
}

function buildRecessRows(schoolId: string, grades: string[]) {
  const rows: any[] = [];
  // Keys must match StepRecessLunch.DEFAULT_BAND_TEMPLATE so the wizard shows the values.
  if (grades.includes('K')) {
    rows.push({ school_id: schoolId, grade_band: 'kindergarten',
      am_recess_start: '09:30:00', am_recess_end: '09:45:00',
      lunch_start: '11:00:00', lunch_end: '11:30:00',
      pm_recess_start: '13:15:00', pm_recess_end: '13:30:00' });
  }
  if (grades.some(g => ['1','2','3'].includes(g))) {
    rows.push({ school_id: schoolId, grade_band: 'primary',
      am_recess_start: '10:00:00', am_recess_end: '10:15:00',
      lunch_start: '11:30:00', lunch_end: '12:00:00',
      pm_recess_start: '13:30:00', pm_recess_end: '13:45:00' });
  }
  if (grades.some(g => ['4','5','6'].includes(g))) {
    rows.push({ school_id: schoolId, grade_band: 'intermediate',
      am_recess_start: '10:30:00', am_recess_end: '10:45:00',
      lunch_start: '12:00:00', lunch_end: '12:30:00',
      pm_recess_start: null, pm_recess_end: null });
  }
  return rows;
}

export async function seedDemoSchool(
  workspaceId: string,
  _userId: string,
  options: SeedDemoOptions = {},
): Promise<{ schoolId: string }> {
  if (inFlight.has(workspaceId)) {
    throw new Error('A demo seed is already in progress for this workspace.');
  }
  inFlight.add(workspaceId);

  const grades = options.gradesServed?.length ? options.gradesServed : ['K','1','2','3','4','5'];
  const teachersPerGrade = Math.min(6, Math.max(1, options.teachersPerGrade ?? 2));
  // When caller passes no conflicts at all (one-click "Seed Demo School"), default to
  // a feature-rich but generator-friendly set so wizards/exports have visible data.
  const conflicts = new Set<DemoConflictKind>(
    options.conflicts ?? ['lunch_clubs', 'admin_rotation'],
  );
  const limited = conflicts.has('limited_specialist_supply');
  const requestedSpecialists = Math.min(10, Math.max(1, options.specialistCount ?? 6));
  const specialistCount = limited
    ? Math.max(1, Math.floor(grades.length / 3))
    : requestedSpecialists;
  const schoolStart = options.schoolStart ?? '07:45';
  const schoolEnd = options.schoolEnd ?? '14:00';

  let schoolId: string | null = null;
  try {
    const suffix = String(Math.floor(100 + Math.random() * 900));
    const schoolName = `Demo Elementary ${suffix}`;
    const year = new Date().getFullYear();

    const conflictStrategies: string[] = [];
    if (conflicts.has('ab_week')) conflictStrategies.push('ab_week');
    if (conflicts.has('lunch_clubs')) conflictStrategies.push('lunch_clubs');

    const midGrade = grades[Math.floor(grades.length / 2)] ?? grades[0];
    const adminRotation = conflicts.has('admin_rotation')
      ? [
          { day: 'Tuesday', startTime: '10:50', endTime: '11:35', grades: [grades[0]], autoSchedule: false, durationMinutes: 45 },
          { day: 'Wednesday', startTime: '13:00', endTime: '13:45', grades: [midGrade], autoSchedule: false, durationMinutes: 45 },
          { day: 'Thursday', startTime: '13:00', endTime: '13:45', grades: [grades[grades.length - 1]], autoSchedule: false, durationMinutes: 45 },
        ]
      : [];

    const { data: school, error: schoolErr } = await supabase
      .from('schools')
      .insert({
        workspace_id: workspaceId,
        name: schoolName,
        website: 'https://demo.example.edu',
        school_year: `${year}-${year + 1}`,
        start_time: `${schoolStart}:00`,
        end_time: `${schoolEnd}:00`,
        grades_served: grades,
        planning_minutes: 225,
        lunch_minutes: 30,
        passing_time: 5,
        setup_time: 10,
        class_duration: 45,
        is_demo: true,
        setup_complete: true,
        setup_step: 11,
        schedule_type: 'whole_school',
        conflict_strategy: 'standard',
        conflict_strategies: conflictStrategies,
        planning_time_when: 'before_school',
        early_release_day: conflicts.has('early_release') ? 'Wed' : null,
        early_release_end_time: conflicts.has('early_release') ? '12:30:00' : null,
        admin_rotation: adminRotation,
      })
      .select('id')
      .single();

    if (schoolErr) throw schoolErr;
    schoolId = school.id;

    // Recess bands per grades present
    const recessRows = buildRecessRows(schoolId, grades);

    // Calendar events — always seed several so Events step isn't bare.
    const calendarEvents: any[] = [
      { school_id: schoolId, title: 'First Day of School', event_type: 'first_day', event_date: `${year}-08-26`, approved: true },
      { school_id: schoolId, title: 'Labor Day (No School)', event_type: 'holiday', event_date: `${year}-09-02`, approved: true },
      { school_id: schoolId, title: 'Picture Day', event_type: 'event', event_date: `${year}-10-14`, approved: true },
      { school_id: schoolId, title: 'Parent-Teacher Conferences', event_type: 'event', event_date: `${year}-11-13`, end_date: `${year}-11-14`, approved: true },
      { school_id: schoolId, title: 'Thanksgiving Break', event_type: 'holiday', event_date: `${year}-11-27`, end_date: `${year}-11-28`, approved: true },
      { school_id: schoolId, title: 'Field Day', event_type: 'event', event_date: `${year + 1}-05-22`, approved: true },
      { school_id: schoolId, title: 'Last Day of School', event_type: 'last_day', event_date: `${year + 1}-06-05`, approved: true },
    ];
    if (conflicts.has('early_release')) {
      calendarEvents.push({ school_id: schoolId, title: 'Early Release Day', event_type: 'early_release', event_date: `${year + 1}-02-12`, approved: true });
    }

    // Specialists
    const baseDays = limited ? ['Mon','Wed','Fri'] : ['Mon','Tue','Wed','Thu','Fri'];
    const specialistRows = ALL_SPECIALIST_TEMPLATES.slice(0, specialistCount).map((tpl, idx) => {
      const row: any = {
        school_id: schoolId,
        name: tpl.name,
        subject: tpl.subject,
        location: tpl.location,
        working_days: [...baseDays],
        uses_cart: false,
        planning_minutes: 45,
        lunch_minutes: 30,
      };
      if (conflicts.has('part_time_specialists') && idx < 2) {
        row.is_part_time = true;
        row.working_days = ['Tue', 'Thu'];
      }
      if (conflicts.has('cart_specialists') && (idx === 1 || idx === 3)) {
        row.uses_cart = true;
      }
      if (conflicts.has('two_school_specialists') && idx === specialistCount - 1) {
        row.two_schools = true;
        row.second_school_name = 'Demo Annex';
        row.second_location = 'Room B';
        row.days_at_second_school = ['Mon', 'Tue'];
        row.working_days = ['Wed','Thu','Fri'];
      }
      return row;
    });

    // Teachers: gradesServed × teachersPerGrade
    const teacherRows: any[] = [];
    const surnames = ['Livermore','Galuardo','Tempo','Paskett','Scott','Cherry','Coonradt','Markulis','Stewart','R. Lee','Soriano','Jones','Diaz','Nguyen','Park','Patel','Brooks','Hayes','Singh','Kim','Russo','Adams','Chen','Lopez','Murphy','Bennett','Fischer','Ortiz','Walsh','Hughes','Reyes','Carter','Foster','Bailey','Watson','Sullivan'];
    let teacherIdx = 0;
    let roomIdx = 1;
    for (const grade of grades) {
      for (let t = 0; t < teachersPerGrade; t++) {
        teacherRows.push({
          school_id: schoolId,
          name: surnames[teacherIdx % surnames.length],
          grade,
          room: `R${roomIdx}`,
          team: grade,
          planning_minutes: 45,
          lunch_minutes: 30,
          weekly_planning_minutes: 225,
          planning_type: 'within_school',
        });
        teacherIdx++;
        roomIdx++;
      }
    }

    // Clubs (only when enabled)
    const clubRows: any[] = conflicts.has('lunch_clubs') ? [
      { school_id: schoolId, name: 'Doodle Club', description: 'Art for K-2', grades: grades.filter(g => ['K','1','2'].includes(g)).join(',') || 'K', day_of_week: 'Mon', start_time: '11:30:00', end_time: '12:00:00', sessions: [] },
      { school_id: schoolId, name: 'Art Apprentice', description: 'Advanced art', grades: grades.filter(g => ['4','5'].includes(g)).join(',') || grades[grades.length - 1], day_of_week: 'Thu', start_time: '12:00:00', end_time: '12:30:00', sessions: [] },
    ] : [];

    const specialEventRows = [
      { school_id: schoolId, name: 'Art Show', event_type: 'assembly', event_date: `${year + 1}-03-15`, start_time: '13:00:00', end_time: '14:00:00' },
    ];

    const inserts: any[] = [
      supabase.from('parsed_calendar_events').insert(calendarEvents),
      supabase.from('specialists').insert(specialistRows),
      supabase.from('classroom_teachers').insert(teacherRows),
      supabase.from('special_events').insert(specialEventRows),
    ];
    if (recessRows.length > 0) inserts.push(supabase.from('recess_lunch_config').insert(recessRows));
    if (clubRows.length > 0) inserts.push(supabase.from('clubs').insert(clubRows));

    const results = await Promise.all(inserts);
    for (const r of results) {
      if (r.error) throw r.error;
    }

    return { schoolId: schoolId! };
  } catch (err) {
    log('seed failed, rolling back', err);
    if (schoolId) {
      try {
        await deleteSchoolsCascade([schoolId]);
      } catch (rbErr) {
        log('rollback failed', rbErr);
      }
    }
    throw err;
  } finally {
    inFlight.delete(workspaceId);
  }
}
