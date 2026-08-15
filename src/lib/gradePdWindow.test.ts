import { describe, expect, it } from 'vitest';
import { gradePdWindows, type PdBlock } from './gradePdWindow';

// These cases mirror supabase/functions/generate-schedule/_teamtime_test.ts.
// If one file's expectations change, the other must change with it — the
// engine scores what this displays.

const T3 = [
  { id: 't1', grade: '3' },
  { id: 't2', grade: '3' },
  { id: 't3', grade: '3' },
];

const blk = (over: Partial<PdBlock>): PdBlock => ({
  day_of_week: 'Mon', start_time: '09:00', end_time: '09:45',
  grade: '3', specialist_id: 'art', teacher_id: 't1', week_label: null, ...over,
});

describe('gradePdWindows', () => {
  it('a pure wheel frees the whole grade at once', () => {
    const w = gradePdWindows([
      blk({ teacher_id: 't1', specialist_id: 'art' }),
      blk({ teacher_id: 't2', specialist_id: 'pe' }),
      blk({ teacher_id: 't3', specialist_id: 'tech' }),
    ], T3).get('3')!;
    expect(w.minutes).toBe(45);
    expect(w.outCount).toBe(3);
    expect(w.startMin).toBe(9 * 60);
  });

  it('back-to-back waves merge into one longer window', () => {
    const wave = (s: string, e: string) => [
      blk({ teacher_id: 't1', specialist_id: 'art', start_time: s, end_time: e }),
      blk({ teacher_id: 't2', specialist_id: 'pe', start_time: s, end_time: e }),
      blk({ teacher_id: 't3', specialist_id: 'tech', start_time: s, end_time: e }),
    ];
    const w = gradePdWindows([...wave('09:00', '09:45'), ...wave('09:50', '10:35')], T3).get('3')!;
    expect(w.minutes).toBe(95);
  });

  it('a staggered wheel yields only the overlap', () => {
    const w = gradePdWindows([
      blk({ teacher_id: 't1', specialist_id: 'art', start_time: '09:00', end_time: '09:45' }),
      blk({ teacher_id: 't2', specialist_id: 'pe', start_time: '09:15', end_time: '10:00' }),
      blk({ teacher_id: 't3', specialist_id: 'tech', start_time: '09:30', end_time: '10:15' }),
    ], T3).get('3')!;
    expect(w.minutes).toBe(15);
  });

  it('an accompanied specialist keeps the teacher in the room', () => {
    const blocks = [
      blk({ teacher_id: 't1', specialist_id: 'art' }),
      blk({ teacher_id: 't2', specialist_id: 'pe' }),
      blk({ teacher_id: 't3', specialist_id: 'lib' }),
    ];
    expect(gradePdWindows(blocks, T3, new Set(['lib'])).get('3')).toBeUndefined();
    // Without the flag the same blocks WOULD be a window — proving the flag did it.
    expect(gradePdWindows(blocks, T3).get('3')?.minutes).toBe(45);
  });

  it('quorum rescues an over-rotated grade (5 classes, 4 specialists)', () => {
    const t5 = ['t1', 't2', 't3', 't4', 't5'].map((id) => ({ id, grade: '5' }));
    const blocks = [
      blk({ grade: '5', teacher_id: 't1', specialist_id: 'art' }),
      blk({ grade: '5', teacher_id: 't2', specialist_id: 'pe' }),
      blk({ grade: '5', teacher_id: 't3', specialist_id: 'tech' }),
      blk({ grade: '5', teacher_id: 't4', specialist_id: 'mus' }),
    ];
    expect(gradePdWindows(blocks, t5).get('5')).toBeUndefined();
    const relaxed = gradePdWindows(blocks, t5, new Set(), 80).get('5')!;
    expect(relaxed.minutes).toBe(45);
    expect(relaxed.outCount).toBe(4);
    expect(relaxed.classCount).toBe(5);
  });

  it('a window must recur in EVERY week label to count', () => {
    const wave = (day: string, label: string, end: string) => [
      blk({ day_of_week: day, week_label: label, teacher_id: 't1', specialist_id: 'art', end_time: end }),
      blk({ day_of_week: day, week_label: label, teacher_id: 't2', specialist_id: 'pe', end_time: end }),
      blk({ day_of_week: day, week_label: label, teacher_id: 't3', specialist_id: 'tech', end_time: end }),
    ];
    // The schedule runs A and B weeks; Monday's window exists only in A, so it
    // is not something the grade can put in the calendar every week.
    const onlyA = gradePdWindows([
      ...wave('Mon', 'A', '09:45'),
      ...wave('Tue', 'B', '09:10'), // makes week B real, but on a different day
    ], T3);
    expect(onlyA.get('3')).toBeUndefined();

    // Present in both weeks: the weaker (20 min) is what the grade can rely on.
    const both = gradePdWindows([...wave('Mon', 'A', '09:45'), ...wave('Mon', 'B', '09:20')], T3).get('3')!;
    expect(both.minutes).toBe(20);
  });

  it('touching blocks are not simultaneous', () => {
    const w = gradePdWindows([
      blk({ teacher_id: 't1', specialist_id: 'art', start_time: '09:00', end_time: '09:45' }),
      blk({ teacher_id: 't2', specialist_id: 'pe', start_time: '09:45', end_time: '10:30' }),
      blk({ teacher_id: 't3', specialist_id: 'tech', start_time: '09:45', end_time: '10:30' }),
    ], T3).get('3');
    expect(w).toBeUndefined();
  });

  it('ignores reserved pseudo-grades and empty input', () => {
    expect(gradePdWindows([], T3).size).toBe(0);
    const w = gradePdWindows([
      blk({ teacher_id: 't1', grade: 'Lunch' }),
      blk({ teacher_id: 't2', grade: 'Planning' }),
      blk({ teacher_id: 't3', specialist_id: 'tech' }),
    ], T3).get('3');
    expect(w).toBeUndefined();
  });
});
