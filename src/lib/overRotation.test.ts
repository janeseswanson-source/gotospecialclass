import { describe, expect, it } from 'vitest';
import { detectOverRotation, describeOverRotation, classCountsByGrade } from './overRotation';

// Her real school: K-4, 1st-3, 2nd-4, 3rd-3, 4th-4, 5th-5 with 4 specialists
// (Garden is part-time and runs a separate wheel).
const KK3 = [
  ...Array(4).fill({ grade: 'K' }),
  ...Array(3).fill({ grade: '1' }),
  ...Array(4).fill({ grade: '2' }),
  ...Array(3).fill({ grade: '3' }),
  ...Array(4).fill({ grade: '4' }),
  ...Array(5).fill({ grade: '5' }),
];

describe('detectOverRotation', () => {
  it('flags only the grade that cannot fit the wheel', () => {
    const found = detectOverRotation({ teachers: KK3, specialistCount: 4 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ grade: '5', classCount: 5, specialistCount: 4, overflow: 1 });
  });

  it('says nothing when every grade fits', () => {
    expect(detectOverRotation({ teachers: KK3, specialistCount: 5 })).toEqual([]);
  });

  it('a grade merely larger than its neighbours is not a problem', () => {
    // 4 classes vs 2 elsewhere, but 4 specialists can still serve them at once.
    const teachers = [...Array(4).fill({ grade: '2' }), ...Array(2).fill({ grade: '1' })];
    expect(detectOverRotation({ teachers, specialistCount: 4 })).toEqual([]);
  });

  it('ranks the worst overflow first', () => {
    const teachers = [...Array(6).fill({ grade: '5' }), ...Array(4).fill({ grade: '3' })];
    const found = detectOverRotation({ teachers, specialistCount: 3 });
    expect(found.map((f) => f.grade)).toEqual(['5', '3']);
  });

  it('ignores reserved pseudo-grades and empty input', () => {
    expect(detectOverRotation({ teachers: [], specialistCount: 4 })).toEqual([]);
    expect(detectOverRotation({ teachers: KK3, specialistCount: 0 })).toEqual([]);
    const counts = classCountsByGrade([{ grade: 'Lunch' }, { grade: '' }, { grade: '3' }]);
    expect([...counts.keys()]).toEqual(['3']);
  });
});

describe('describeOverRotation', () => {
  it('reads like her own description of the problem', () => {
    const [f] = detectOverRotation({ teachers: KK3, specialistCount: 4 });
    expect(describeOverRotation(f)).toBe(
      "Grade 5 has 5 classes (others have 3–4) and you have 4 specialists, so 1 class can't fit in one rotation.",
    );
  });
});
