import { describe, expect, it } from 'vitest';
import { formatGradeOrdinal, gradeRank } from './gradeOrdinal';

describe('formatGradeOrdinal', () => {
  it('formats numeric grades as ordinals', () => {
    expect(formatGradeOrdinal('1')).toBe('1st');
    expect(formatGradeOrdinal('2')).toBe('2nd');
    expect(formatGradeOrdinal('3')).toBe('3rd');
    expect(formatGradeOrdinal('4')).toBe('4th');
    expect(formatGradeOrdinal('5')).toBe('5th');
    expect(formatGradeOrdinal('10')).toBe('10th');
    expect(formatGradeOrdinal('11')).toBe('11th');
    expect(formatGradeOrdinal('12')).toBe('12th');
    expect(formatGradeOrdinal('13')).toBe('13th');
    expect(formatGradeOrdinal('21')).toBe('21st');
  });

  it('passes non-numeric grades through unchanged', () => {
    expect(formatGradeOrdinal('K')).toBe('K');
    expect(formatGradeOrdinal('TK')).toBe('TK');
    expect(formatGradeOrdinal('PreK')).toBe('PreK');
    expect(formatGradeOrdinal('Lunch')).toBe('Lunch');
  });

  it('handles empty input', () => {
    expect(formatGradeOrdinal(null)).toBe('');
    expect(formatGradeOrdinal(undefined)).toBe('');
    expect(formatGradeOrdinal('')).toBe('');
  });
});

describe('gradeRank', () => {
  it('orders PreK < TK < K < numerics < unknown < missing', () => {
    const order = ['5', null, 'K', 'PreK', 'Art', '1', 'TK'].sort(
      (a, b) => gradeRank(a) - gradeRank(b),
    );
    expect(order).toEqual(['PreK', 'TK', 'K', '1', '5', 'Art', null]);
  });

  it('accepts Pre-K spelling', () => {
    expect(gradeRank('Pre-K')).toBe(gradeRank('PreK'));
  });
});
