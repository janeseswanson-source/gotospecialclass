import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { formatTime } from '@/lib/utils';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

function splitName(full: string | null | undefined): [string, string] {
  if (!full) return ['', ''];
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return [parts[0], ''];
  return [parts[0], parts.slice(1).join(' ')];
}

function classifyBlockType(subject: string | null | undefined): string {
  const s = (subject ?? '').toLowerCase();
  if (/planning|prep/.test(s)) return 'planning_prep';
  if (/recess/.test(s)) return 'recess';
  if (/lunch/.test(s)) return 'lunch';
  if (/dismiss/.test(s)) return 'dismissal';
  return 'rotation';
}

function sheetFromAOA(aoa: any[][], colWidths?: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (colWidths) (ws as any)['!cols'] = colWidths.map((w) => ({ wch: w }));
  return ws;
}

export async function exportMasterAdminXlsx(opts: {
  schoolId: string;
  generationId: string | null;
}) {
  const { schoolId, generationId } = opts;

  const [{ data: school }, { data: specialists }, { data: teachers }, { data: blocksData }, { data: rotationsData }, { data: clubsData }] =
    await Promise.all([
      supabase.from('schools').select('*').eq('id', schoolId).maybeSingle(),
      supabase.from('specialists').select('*').eq('school_id', schoolId),
      supabase.from('classroom_teachers').select('*').eq('school_id', schoolId),
      generationId
        ? supabase.from('schedule_blocks').select('*').eq('generation_id', generationId)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('class_rotations').select('*').eq('school_id', schoolId),
      supabase.from('clubs').select('*').eq('school_id', schoolId),
    ]);

  const sp = specialists ?? [];
  const tc = teachers ?? [];
  const blocks = (blocksData ?? []) as any[];
  const rotations = (rotationsData ?? []) as any[];
  const clubs = (clubsData ?? []) as any[];

  const specialistById: Record<string, any> = Object.fromEntries(sp.map((s: any) => [s.id, s]));
  const teacherById: Record<string, any> = Object.fromEntries(tc.map((t: any) => [t.id, t]));

  const wb = XLSX.utils.book_new();

  // === Sheet 1: Master Admin View ===
  const adminRotation: any[] = Array.isArray(school?.admin_rotation) ? school!.admin_rotation : [];
  const planningByDay: Record<string, any[]> = Object.fromEntries(DAYS.map((d) => [d, []]));
  for (const ar of adminRotation) {
    const key = DAYS.find((d) => d.toLowerCase() === (ar.day || '').toLowerCase());
    if (key) planningByDay[key].push(ar);
  }
  const grouped: Record<string, any[]> = {};
  for (const b of blocks) {
    if (classifyBlockType(b.subject) !== 'rotation') continue;
    const k = `${b.start_time}|${b.end_time}`;
    (grouped[k] ??= []).push(b);
  }
  const slotKeys = Object.keys(grouped).sort();

  const masterAoa: any[][] = [];
  masterAoa.push([`Specialist Schedule Planner — ${school?.name ?? ''}`, '', '', '', '']);
  masterAoa.push([
    `Year: ${school?.school_year ?? ''}`,
    '',
    `Day: ${school?.start_time ? formatTime(school.start_time) : ''} – ${school?.end_time ? formatTime(school.end_time) : ''}`,
    '',
    'www.GoToSpecialClass.com',
  ]);
  masterAoa.push([...DAYS]);
  masterAoa.push(['Planning and Prep', '', '', '', '']);
  // P&P rows
  for (const day of DAYS) {
    const cells = planningByDay[day].map((ar) => {
      const lines: string[] = [];
      if (ar.rotationLabel) lines.push(`${ar.rotationLabel}${ar.weekLabel ? `  (${ar.weekLabel})` : ''}`);
      if (ar.startTime && ar.endTime) lines.push(`${formatTime(ar.startTime)} – ${formatTime(ar.endTime)}`);
      sp.slice(0, 4).forEach((s: any) => lines.push(`${s.subject ?? ''}  ${s.name ?? ''}`));
      return lines.join('\n');
    });
    masterAoa.push(DAYS.map((d, i) => (d === day ? cells.join('\n\n') : '')));
  }
  // Rotation slot rows
  for (const k of slotKeys) {
    const [s, e] = k.split('|');
    masterAoa.push([`${formatTime(s)} – ${formatTime(e)}`, '', '', '', '']);
    const row: string[] = [];
    for (const day of DAYS) {
      const cell = grouped[k]
        .filter((b) => b.day_of_week === day)
        .map((b) => {
          const spec = specialistById[b.specialist_id]?.name ?? '';
          const sub = b.subject ?? specialistById[b.specialist_id]?.subject ?? '';
          const grade = b.grade ?? '';
          const t = teacherById[b.teacher_id]?.name ?? '';
          const wk = b.week_label ? ` (${b.week_label})` : '';
          return `${grade}  ${sub}${wk}\n${spec}${t ? ` · ${t}` : ''}`;
        })
        .join('\n\n');
      row.push(cell);
    }
    masterAoa.push(row);
  }
  // Chrome rows
  for (const kind of ['recess', 'lunch', 'dismissal'] as const) {
    const chromeBlocks = blocks.filter((b) => classifyBlockType(b.subject) === kind);
    if (!chromeBlocks.length) continue;
    masterAoa.push([kind.toUpperCase(), '', '', '', '']);
    masterAoa.push(
      DAYS.map((d) =>
        chromeBlocks
          .filter((b) => b.day_of_week === d)
          .map((b) => `${b.grade ?? ''} Graders\n${formatTime(b.start_time)} – ${formatTime(b.end_time)}`)
          .join('\n\n')
      )
    );
  }

  const masterWs = sheetFromAOA(masterAoa, [22, 22, 22, 22, 22]);
  // merge title row
  (masterWs as any)['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  XLSX.utils.book_append_sheet(wb, masterWs, 'Master Admin View');

  // === Sheet 2: Schools ===
  const schoolsAoa = [
    [
      'school_id', 'school_name', 'site_url', 'district', 'principal_name', 'principal_email',
      'admin_contact', 'admin_email', 'phone', 'address', 'city', 'state', 'zip', 'timezone',
      'regular_dismissal_time', 'early_dismissal_time', 'early_dismissal_day', 'notes',
    ],
    school
      ? [
          school.id,
          school.name,
          school.website ?? '',
          school.district ?? '',
          school.principal_name ?? '',
          school.principal_email ?? '',
          school.admin_contact ?? '',
          school.admin_email ?? '',
          school.phone ?? '',
          school.address ?? '',
          school.city ?? '',
          school.state ?? '',
          school.zip ?? '',
          school.timezone ?? '',
          school.end_time ?? '',
          school.early_release_end_time ?? '',
          school.early_release_day ?? '',
          school.notes ?? '',
        ]
      : [],
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(schoolsAoa, Array(18).fill(18)), 'Schools');

  // === Sheet 3: Specialists ===
  const specialistsAoa: any[][] = [[
    'specialist_id', 'school_id', 'first_name', 'last_name', 'email', 'subject', 'room_number',
    'uses_cart', 'is_part_time', 'part_time_days', 'serves_multiple_schools', 'second_school_id',
    'grades_served', 'custom_grade_preference', 'notes',
  ]];
  for (const s of sp as any[]) {
    const [first, last] = splitName(s.name);
    specialistsAoa.push([
      s.id, s.school_id, first, last, s.email ?? '', s.subject ?? '', s.location ?? s.room ?? '',
      s.uses_cart ? 'TRUE' : 'FALSE',
      s.is_part_time ? 'TRUE' : 'FALSE',
      Array.isArray(s.part_time_days) ? s.part_time_days.join('|') : (s.days ? (Array.isArray(s.days) ? s.days.join('|') : s.days) : ''),
      s.two_schools ? 'TRUE' : 'FALSE',
      s.second_school_id ?? s.second_school_name ?? '',
      Array.isArray(s.grades_served) ? s.grades_served.join('|') : (s.grades_served ?? ''),
      s.custom_grade_preference ?? s.grade_preference ?? '',
      s.notes ?? '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(specialistsAoa, Array(15).fill(18)), 'Specialists');

  // === Sheet 4: Schedule Blocks ===
  const blocksAoa: any[][] = [[
    'block_id', 'school_id', 'block_name', 'start_time', 'end_time', 'block_type', 'days_active',
    'grade_group', 'notes',
  ]];
  for (const b of blocks) {
    blocksAoa.push([
      b.id, schoolId, b.subject ?? '', b.start_time ?? '', b.end_time ?? '',
      classifyBlockType(b.subject), b.day_of_week ?? '', b.grade ?? '', b.notes ?? '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(blocksAoa, Array(9).fill(18)), 'Schedule Blocks');

  // === Sheet 5: Rotations ===
  const rotationsAoa: any[][] = [[
    'rotation_id', 'school_id', 'block_id', 'specialist_id', 'rotation_label', 'grade_group',
    'classroom_teacher', 'day_of_week', 'room_or_location', 'week_pattern', 'start_date', 'end_date', 'notes',
  ]];
  for (const r of rotations) {
    rotationsAoa.push([
      r.id, r.school_id, '', r.specialist_id ?? '', r.rotation_type ?? '',
      r.grade ?? '', teacherById[r.teacher_id]?.name ?? '', r.day_of_week ?? '',
      '', r.week_label ?? '', '', '', r.notes ?? '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(rotationsAoa, Array(13).fill(16)), 'Rotations');

  // === Sheet 6: Classrooms ===
  const classroomsAoa: any[][] = [[
    'classroom_id', 'school_id', 'teacher_first_name', 'teacher_last_name', 'teacher_email',
    'grade', 'room_number', 'homeroom_label', 'student_count', 'special_notes',
  ]];
  for (const t of tc as any[]) {
    const [first, last] = splitName(t.name);
    classroomsAoa.push([
      t.id, t.school_id, first, last, t.email ?? '', t.grade ?? '', t.room ?? '',
      t.team ?? '', '', '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(classroomsAoa, Array(10).fill(18)), 'Classrooms');

  // === Sheet 7: PLUS Rotations ===
  const plusAoa: any[][] = [[
    'plus_id', 'school_id', 'plus_name', 'days_active', 'start_time', 'end_time',
    'grades_included', 'specialist_id', 'notes',
  ]];
  for (const ar of adminRotation) {
    plusAoa.push([
      '', schoolId, ar.rotationLabel || 'Admin Rotation', ar.day ?? '',
      ar.startTime ?? '', ar.endTime ?? '',
      Array.isArray(ar.grades) ? ar.grades.join('|') : '', '', ar.weekLabel ? `Week ${ar.weekLabel}` : '',
    ]);
  }
  for (const c of clubs as any[]) {
    plusAoa.push([
      c.id, c.school_id, c.name ?? '', Array.isArray(c.days) ? c.days.join('|') : (c.day ?? ''),
      c.start_time ?? '', c.end_time ?? '',
      Array.isArray(c.grades) ? c.grades.join('|') : (c.grade ?? ''),
      c.specialist_id ?? '', c.notes ?? '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(plusAoa, Array(9).fill(16)), 'PLUS Rotations');

  const safeName = (school?.name ?? 'school').replace(/[^a-z0-9]+/gi, '_');
  XLSX.writeFile(wb, `MasterAdminView_${safeName}.xlsx`);
}
