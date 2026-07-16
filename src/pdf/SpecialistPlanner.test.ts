import { describe, expect, it } from 'vitest';
import { buildBandRows, type RecessRow } from './SpecialistPlanner';

const MONSTER = 'AM Recess · AM Recess · AM Recess · band_o3re5m';

const row = (over: Partial<RecessRow>): RecessRow => ({ grade_band: 'all', ...over });

describe('buildBandRows', () => {
  it('KK3 shape: many rows sharing one window → ONE clean phrase, no "All", no garbage', () => {
    const rows = [
      row({ grade_band: 'all', am_recess_start: '10:00', am_recess_end: '10:15' }),
      row({ grade_band: 'band_o3re5m', am_recess_start: '10:00', am_recess_end: '10:15' }),
      row({ grade_band: 'all', am_recess_start: '10:00', am_recess_end: '10:15' }),
    ];
    const out = buildBandRows(rows, { band_o3re5m: MONSTER });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('RECESS');
    expect(out[0].text).toBe('Recess is 10:00 - 10:15');
  });

  it('distinct windows stay separate phrases with their labels', () => {
    const rows = [
      row({ grade_band: 'k2', am_recess_start: '09:30', am_recess_end: '09:45' }),
      row({ grade_band: 'g35', am_recess_start: '10:00', am_recess_end: '10:15' }),
    ];
    const out = buildBandRows(rows, { k2: 'K-2', g35: '3-5' });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('K-2 Recess is 9:30 - 9:45    3-5 Recess is 10:00 - 10:15');
    expect(out[0].sort).toBe('09:30');
  });

  it('lunch folds its PM recess into "w/ recess at" phrasing', () => {
    const rows = [
      row({ grade_band: 'k2', lunch_start: '11:00', lunch_end: '11:30', pm_recess_start: '11:30', pm_recess_end: '11:45' }),
      row({ grade_band: 'g35', lunch_start: '11:40', lunch_end: '12:10', pm_recess_start: '12:10', pm_recess_end: '12:25' }),
    ];
    const out = buildBandRows(rows, { k2: 'K-2', g35: '3-5' });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toContain('LUNCH');
    expect(out[0].text).toBe(
      'K-2 Lunch is 11:00 - 11:30 w/ recess at 11:30 - 11:45    3-5 Lunch is 11:40 - 12:10 w/ recess at 12:10 - 12:25',
    );
  });

  it('same lunch window shared by clean + garbage rows → one unlabelled phrase', () => {
    const rows = [
      row({ grade_band: 'all', lunch_start: '11:40', lunch_end: '12:10', pm_recess_start: '12:10', pm_recess_end: '12:25' }),
      row({ grade_band: 'band_xgvk5p', lunch_start: '11:40', lunch_end: '12:10', pm_recess_start: '12:10', pm_recess_end: '12:25' }),
    ];
    const out = buildBandRows(rows, { band_xgvk5p: 'Lunch · Lunch · band_xgvk5p' });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Lunch is 11:40 - 12:10 w/ recess at 12:10 - 12:25');
  });

  it('standalone PM recess (no lunch on that band) gets its own row', () => {
    const rows = [row({ grade_band: 'k2', pm_recess_start: '14:00', pm_recess_end: '14:15' })];
    const out = buildBandRows(rows, { k2: 'K-2' });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('K-2 PM Recess is 2:00 - 2:15');
  });

  it('caps distinct labels per window at 3 with "+N more"', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((k) =>
      row({ grade_band: k, am_recess_start: '10:00', am_recess_end: '10:15' }));
    const out = buildBandRows(rows, { a: 'A1', b: 'B2', c: 'C3', d: 'D4', e: 'E5' });
    expect(out[0].text).toBe('A1 & B2 & C3 +2 more Recess is 10:00 - 10:15');
  });

  it('no recess config → no band rows', () => {
    expect(buildBandRows([], {})).toHaveLength(0);
  });
});
