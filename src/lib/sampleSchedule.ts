// A realistic, self-contained sample week so new users can SEE what a finished
// schedule looks like before doing any setup. Pure static data — never written
// to the database; rendered read-only in the sample preview.
import type { BlockData, RecessBand } from "@/components/schedule/ScheduleGrid";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Four specialists rotating K–5 across the day.
const SPECIALISTS = [
  { subject: "Art", name: "Ms. Rivera", room: "Art Studio" },
  { subject: "Music", name: "Mr. Okafor", room: "Music Rm" },
  { subject: "PE", name: "Coach Bell", room: "Gym" },
  { subject: "Library", name: "Mrs. Lindqvist", room: "Library" },
];

// Teaching periods (start, end). Recess and lunch sit between them.
const PERIODS = [
  ["08:30", "09:15"],
  ["09:15", "10:00"],
  ["10:00", "10:45"],
  // 10:45–11:00 recess
  ["11:00", "11:45"],
  // 11:45–12:30 lunch
  ["12:30", "13:15"],
  ["13:15", "14:00"],
];

const GRADES = ["K", "1", "2", "3", "4", "5"];
const TEACHERS = ["Adams", "Brooks", "Chen", "Diaz", "Evans", "Ford"];

export const SAMPLE_TIMESLOTS: string[] = PERIODS.map((p) => `${p[0]}:00`);

export const SAMPLE_RECESS: RecessBand[] = [
  { id: "rec", label: "Recess", start_time: "10:45:00", end_time: "11:00:00" },
  { id: "lunch", label: "Lunch", start_time: "11:45:00", end_time: "12:30:00" },
];

// Build one block per specialist per period, rotating which grade each sees so
// the grid looks busy and believable (each specialist teaches a different grade
// each period, no two specialists share a teacher at the same time).
export const SAMPLE_BLOCKS: BlockData[] = (() => {
  const blocks: BlockData[] = [];
  let n = 0;
  DAYS.forEach((day, di) => {
    PERIODS.forEach(([start, end], pi) => {
      SPECIALISTS.forEach((sp, si) => {
        // Rotate grade by day+period+specialist so assignments don't collide.
        const gradeIdx = (di + pi + si) % GRADES.length;
        const teacherIdx = (di + pi + si) % TEACHERS.length;
        // Leave a couple of holes so it reads like a real week, not a solid block.
        if ((di + pi + si) % 7 === 0) return;
        blocks.push({
          id: `sample-${n++}`,
          day_of_week: day,
          start_time: `${start}:00`,
          end_time: `${end}:00`,
          subject: sp.subject,
          specialist_name: sp.name,
          teacher_name: `Mr${gradeIdx % 2 ? "s" : ""}. ${TEACHERS[teacherIdx]}`,
          grade: GRADES[gradeIdx],
          room: sp.room,
        });
      });
    });
  });
  return blocks;
})();
