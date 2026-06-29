// Phase 3D: scheduler fixtures.
//
// Three SchedulerInput-shaped payloads (tiny / medium / large) that drive
// `generateScheduleBlocks` end-to-end without touching the database. Used by
// `_fixtures_test.ts` for determinism + regression assertions.
//
// IDs are stable hex UUIDs so block payloads are byte-comparable across runs.

export interface FixtureInput {
  name: "tiny" | "medium" | "large";
  generationId: string;
  specialists: any[];
  teachers: any[];
  grades: string[];
  school: any;
  recessConfigs: any[];
  clubs: any[];
  specialEvents: any[];
  calendarEvents: any[];
  adminBlocks: any[];
  /** Phase 3A baseline preference-violation count (must not regress). */
  phase3aBaselineViolations: number;
}

const baseSchool = {
  start_time: "08:00",
  end_time: "15:00",
  early_release_day: null,
  early_release_end_time: null,
  class_duration: 45,
  setup_time: 5,
  passing_time: 5,
  planning_minutes: 0,
  schedule_type: "whole_school",
  conflict_strategy: "standard",
  conflict_strategies: ["standard"],
  conflict_grades: [],
  conflict_timing: "before",
  grade_time_config: {},
  planning_time_when: "during_rotations",
};

function spec(id: string, name: string, subject: string, opts: Partial<any> = {}): any {
  return {
    id,
    name,
    subject,
    working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    planning_minutes: 30,
    lunch_minutes: 30,
    uses_cart: false,
    two_schools: false,
    is_part_time: false,
    part_time_planning_minutes: 30,
    part_time_lunch_minutes: 20,
    grade_rotation: null,
    location: null,
    second_location: null,
    weekly_planning_minutes: 150,
    additional_minutes: [],
    ...opts,
  };
}

function teacher(id: string, name: string, grade: string, opts: Partial<any> = {}): any {
  return {
    id,
    name,
    grade,
    room: `R-${id.slice(-3)}`,
    am_pm_preference: null,
    day_preference: null,
    planning_minutes: 30,
    weekly_planning_minutes: 150,
    lunch_minutes: 30,
    ...opts,
  };
}

// ─── Tiny: 1 specialist, 2 grades, 2 teachers ────────────────────────
export const tinyFixture: FixtureInput = {
  name: "tiny",
  generationId: "00000000-0000-4000-a000-00000000aaaa",
  specialists: [spec("11111111-1111-4111-a111-111111111111", "Art Teacher", "Art")],
  teachers: [
    teacher("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1", "Smith", "K"),
    teacher("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa2", "Jones", "1"),
  ],
  grades: ["K", "1"],
  school: { ...baseSchool },
  recessConfigs: [],
  clubs: [],
  specialEvents: [],
  calendarEvents: [],
  adminBlocks: [],
  phase3aBaselineViolations: 0,
};

// ─── Medium: 3 specialists, K–5 ─────────────────────────────────────
export const mediumFixture: FixtureInput = {
  name: "medium",
  generationId: "00000000-0000-4000-a000-00000000bbbb",
  specialists: [
    spec("22222222-2222-4222-a222-222222222221", "Art", "Art"),
    spec("22222222-2222-4222-a222-222222222222", "Music", "Music"),
    spec("22222222-2222-4222-a222-222222222223", "PE", "PE"),
  ],
  teachers: ["K", "1", "2", "3", "4", "5"].map((g, i) =>
    teacher(`bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbb${(i + 10).toString(16).padStart(2, "0")}`, `T${g}`, g, {
      am_pm_preference: i === 0 ? "AM" : null,
      day_preference: i === 1 ? "Tuesday" : null,
    }),
  ),
  grades: ["K", "1", "2", "3", "4", "5"],
  school: { ...baseSchool },
  recessConfigs: [],
  clubs: [],
  specialEvents: [],
  calendarEvents: [],
  adminBlocks: [],
  phase3aBaselineViolations: 5,
};

// ─── Large: mirrors demo school shape (4 specialists, K–5 w/ duplicates) ──
export const largeFixture: FixtureInput = {
  name: "large",
  generationId: "00000000-0000-4000-a000-00000000cccc",
  specialists: [
    spec("33333333-3333-4333-a333-333333333331", "Art", "Art"),
    spec("33333333-3333-4333-a333-333333333332", "Music", "Music"),
    spec("33333333-3333-4333-a333-333333333333", "PE", "PE"),
    spec("33333333-3333-4333-a333-333333333334", "Library", "Library"),
  ],
  teachers: (() => {
    const ts: any[] = [];
    const grades = ["K", "1", "2", "3", "4", "5"];
    let i = 0;
    for (const g of grades) {
      for (const cls of ["A", "B"]) {
        const id = `cccccccc-cccc-4ccc-cccc-cccccccccc${(i + 16).toString(16).padStart(2, "0")}`;
        ts.push(teacher(id, `${g}${cls}`, g));
        i++;
      }
    }
    return ts;
  })(),
  grades: ["K", "1", "2", "3", "4", "5"],
  school: { ...baseSchool },
  recessConfigs: [],
  clubs: [],
  specialEvents: [],
  calendarEvents: [],
  adminBlocks: [],
  phase3aBaselineViolations: 5,
};

export const allFixtures: FixtureInput[] = [tinyFixture, mediumFixture, largeFixture];
