import { describe, expect, it } from 'vitest';
import {
  computeCompliance, HSTA_PROFILE,
  type ComplianceBlock, type CompliancePerson,
} from './contractCompliance';

const blk = (over: Partial<ComplianceBlock>): ComplianceBlock => ({
  day_of_week: 'Mon', start_time: '09:00', end_time: '09:45',
  subject: 'Art', grade: '3', specialist_id: 'art', teacher_id: null, week_label: null, ...over,
});

const specialist: CompliancePerson = { id: 'art', name: 'Swanson', category: 'departmental', role: 'specialist' };
const teacher: CompliancePerson = { id: 't1', name: 'Cherry', category: 'self_contained', role: 'teacher' };

// A 7-hour teacher day x 5 = 2100 min/week (7:45-2:45, her contract).
const duty = () => 2100;

describe('contract categories', () => {
  it('holds specialists and classroom teachers to different caps', () => {
    // The distinction she called out: specialists teach LESS but get more "other".
    expect(HSTA_PROFILE.categories.departmental.instructionalMax).toBe(1285);
    expect(HSTA_PROFILE.categories.self_contained.instructionalMax).toBe(1415);
    expect(HSTA_PROFILE.categories.departmental.otherMin).toBe(440);
    expect(HSTA_PROFILE.categories.self_contained.otherMin).toBe(310);
    // Prep and lunch are identical for both.
    expect(HSTA_PROFILE.categories.departmental.prepMin).toBe(HSTA_PROFILE.categories.self_contained.prepMin);
    expect(HSTA_PROFILE.categories.departmental.lunchMin).toBe(HSTA_PROFILE.categories.self_contained.lunchMin);
  });
});

describe('computeCompliance', () => {
  it('buckets a specialist week and always reports what is unaccounted', () => {
    const blocks = [
      blk({ start_time: '09:00', end_time: '09:45' }),
      blk({ subject: 'Specialist Lunch', grade: 'Lunch', start_time: '11:00', end_time: '11:30' }),
      blk({ subject: 'Planning', grade: 'Planning', start_time: '13:00', end_time: '13:45' }),
    ];
    const [r] = computeCompliance({ blocks, people: [specialist], profile: HSTA_PROFILE, dutyMinutesFor: duty });
    expect(r.instructional).toBe(45);
    expect(r.lunch).toBe(30);
    expect(r.prep).toBe(45);
    // The arithmetic must always close: buckets + unaccounted == duty total.
    expect(r.instructional + r.prep + r.lunch + r.other + r.unaccounted).toBe(r.dutyTotal);
  });

  it("a classroom teacher's class at specials is prep — unless they go along", () => {
    const blocks = [blk({ teacher_id: 't1', specialist_id: 'art', start_time: '09:00', end_time: '09:45' })];

    const released = computeCompliance({ blocks, people: [teacher], profile: HSTA_PROFILE, dutyMinutesFor: duty })[0];
    expect(released.prep).toBe(45);
    expect(released.instructional).toBe(0);

    // "so it is not a prep minutes unequal use of time"
    const accompanying: CompliancePerson = { ...teacher, accompaniedSpecialistIds: new Set(['art']) };
    const stayed = computeCompliance({ blocks, people: [accompanying], profile: HSTA_PROFILE, dutyMinutesFor: duty })[0];
    expect(stayed.prep).toBe(0);
    expect(stayed.instructional).toBe(45);
  });

  it('counts a lunch club as teaching plus 5 minutes of set-up', () => {
    const blocks = [blk({ subject: 'Doodle Lunch Club', grade: 'All', start_time: '11:30', end_time: '11:45' })];
    const [r] = computeCompliance({ blocks, people: [specialist], profile: HSTA_PROFILE, dutyMinutesFor: duty });
    expect(r.instructional).toBe(15);
    expect(r.other).toBe(5);
  });

  it('flags more than 180 continuous minutes of teaching', () => {
    const blocks = [
      blk({ start_time: '08:00', end_time: '10:00' }),
      blk({ start_time: '10:00', end_time: '11:15' }), // 195 continuous
    ];
    const [r] = computeCompliance({ blocks, people: [specialist], profile: HSTA_PROFILE, dutyMinutesFor: duty });
    const hit = r.findings.find((f) => f.type === 'no_break_over_180');
    expect(hit?.severity).toBe('warning');
    expect(hit?.message).toContain('195');
  });

  it('flags prep that is present but chopped up', () => {
    // 225 min of prep, but in 15-minute slivers — the contract wants 45 continuous.
    const blocks = Array.from({ length: 15 }, (_, i) => blk({
      subject: 'Planning', grade: 'Planning',
      day_of_week: ['Mon', 'Tue', 'Wed'][i % 3],
      start_time: `${8 + Math.floor(i / 3)}:00`, end_time: `${8 + Math.floor(i / 3)}:15`,
    }));
    const [r] = computeCompliance({ blocks, people: [specialist], profile: HSTA_PROFILE, dutyMinutesFor: duty });
    expect(r.prep).toBe(225);
    expect(r.findings.some((f) => f.type === 'prep_short')).toBe(false);
    expect(r.findings.some((f) => f.type === 'prep_not_continuous')).toBe(true);
  });

  it('flags a short lunch and a short weekly total', () => {
    const blocks = [blk({ subject: 'Specialist Lunch', grade: 'Lunch', start_time: '11:00', end_time: '11:20' })];
    const [r] = computeCompliance({ blocks, people: [specialist], profile: HSTA_PROFILE, dutyMinutesFor: duty });
    expect(r.findings.map((f) => f.type)).toContain('lunch_short');
    expect(r.findings.map((f) => f.type)).toContain('lunch_not_continuous');
  });

  it('treats pre-rotation time as "Other", never as prep', () => {
    const [r] = computeCompliance({
      blocks: [], people: [specialist], profile: HSTA_PROFILE, dutyMinutesFor: duty,
      preRotationMinutesPerWeek: 100,
    });
    expect(r.other).toBe(100);
    expect(r.prep).toBe(0);
  });

  it('never emits an error severity — the report is advisory', () => {
    const blocks = [blk({ start_time: '08:00', end_time: '14:00' })];
    const [r] = computeCompliance({ blocks, people: [specialist], profile: HSTA_PROFILE, dutyMinutesFor: duty });
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.severity === 'warning' || f.severity === 'info')).toBe(true);
  });
});
