// Generate the blank prep sheet on demand, as a FILLABLE PDF.
//
// The "Download blank template" button used to hand over a static, image-only
// file checked into /public — "Pretty cool if you can edit it but my pdf is
// not editable." This builds the same sheet with real AcroForm text fields, so
// it can be typed into and saved (or still printed and written on).
//
// react-pdf is ~1.4 MB, so it is imported dynamically: the cost is paid only
// when someone actually asks for the sheet.

/** The questions on the blank sheet, with stable AcroForm field names. */
export const BLANK_PREP_ROWS: Array<{ question: string; field: string }> = [
  { question: 'School name', field: 'school_name' },
  { question: 'School site URL', field: 'school_site_url' },
  { question: 'District calendar URL', field: 'district_calendar_url' },
  { question: 'First day of school (students)', field: 'first_day' },
  { question: 'School day starts / ends', field: 'bell_times' },
  { question: 'Specials rotations begin at (time)', field: 'rotations_start_time' },
  { question: 'Specials rotations begin (date)', field: 'rotations_start_date' },
  { question: 'Teacher work day starts / ends', field: 'teacher_day' },
  { question: 'Weekly early-release day', field: 'early_release_day' },
  { question: 'Early-release end time', field: 'early_release_end_time' },
  { question: 'Grades served (e.g. K–5)', field: 'grades_served' },
  { question: 'Classes per grade (e.g. K:4, 1st:3…)', field: 'classes_per_grade' },
  { question: 'Class length (minutes)', field: 'class_duration' },
  { question: 'Passing time between classes', field: 'passing_time' },
  { question: 'Recess windows (per grade band)', field: 'recess_windows' },
  { question: 'Lunch windows (per grade band)', field: 'lunch_windows' },
  { question: 'Specialists — name and subject, one per line', field: 'specialists' },
  { question: 'Which specialists travel with a cart?', field: 'cart_users' },
  { question: 'Which specialists work at two schools?', field: 'two_school_users' },
  { question: 'Part-time specialists (with days)', field: 'part_time_users' },
  { question: 'Does a teacher go with the class? (Library, Garden…)', field: 'teacher_accompanies' },
  { question: 'Teacher union link', field: 'teacher_union_url' },
  { question: 'Teacher contract link', field: 'teacher_contract_url' },
  { question: 'Grade-level PD target (90 or 120 min)', field: 'grade_pd_target_minutes' },
  { question: 'Anything else we should know?', field: 'notes' },
];

/** Build the blank fillable sheet and hand it to the browser. */
export async function downloadBlankPrepSheet(schoolName?: string): Promise<void> {
  const [{ pdf }, { default: CoordinatorPrepDoc }, { createElement }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/pdf/CoordinatorPrep'),
    import('react'),
  ]);

  const blob = await pdf(
    createElement(CoordinatorPrepDoc, {
      schoolName,
      rows: BLANK_PREP_ROWS,
      fillable: true,
    }) as never,
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'specialist-ops-prep-sheet.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
