import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSpecialistPaste, normalizeSubject } from './parseSpecialistPaste';

describe('parseSpecialistPaste — the shipped template', () => {
  const csv = fs.readFileSync(
    path.resolve(process.cwd(), 'public/templates/specialists_template.csv'),
    'utf8',
  );

  it('imports every row from the app\'s own template', () => {
    const res = parseSpecialistPaste(csv);
    expect(res.headerDetected).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.rows.length).toBeGreaterThanOrEqual(2);
    expect(res.rows[0]).toMatchObject({ name: 'Swanson', subject: 'Art' });
  });
});

describe('parseSpecialistPaste — the simple two-column template', () => {
  const csv = fs.readFileSync(
    path.resolve(process.cwd(), 'public/templates/specialists_template_simple.csv'),
    'utf8',
  );
  it('imports name + subject with no warnings', () => {
    const res = parseSpecialistPaste(csv);
    expect(res.warnings).toEqual([]);
    expect(res.rows.map((r) => `${r.name}/${r.subject}`)).toEqual(['Swanson/Art', 'Grace/Tech', 'Nunez/PE']);
  });
});

describe('parseSpecialistPaste', () => {
  it('reads the two-column list a coordinator would paste', () => {
    const res = parseSpecialistPaste('Swanson, Art\nGrace, Technology\nNunez, PE');
    expect(res.rows).toHaveLength(3);
    expect(res.rows.map((r) => r.subject)).toEqual(['Art', 'Tech', 'PE']);
  });

  it('handles her PDF\'s header wording', () => {
    const res = parseSpecialistPaste('Specialist Teacher Name,Speciality Department\nLee,Library');
    expect(res.headerDetected).toBe(true);
    expect(res.rows[0]).toMatchObject({ name: 'Lee', subject: 'Library' });
  });

  it('accepts tabs, dashes and BOMs', () => {
    expect(parseSpecialistPaste('Kim\tGarden').rows[0]).toMatchObject({ name: 'Kim', subject: 'Garden' });
    expect(parseSpecialistPaste('Ito - Music').rows[0]).toMatchObject({ name: 'Ito', subject: 'Music' });
    const bom = String.fromCharCode(0xfeff);
    const bomRes = parseSpecialistPaste(`${bom}Name,Subject\nOno,Art`);
    expect(bomRes.rows[0].name).toBe('Ono');
    // Warning-free proves the BOM'd header cell was recognised, not rescued.
    expect(bomRes.warnings).toEqual([]);
  });

  it('falls back to positional when the header names no name column', () => {
    const res = parseSpecialistPaste('person,subject\nRuiz,PE');
    expect(res.rows[0]).toMatchObject({ name: 'Ruiz', subject: 'PE' });
  });

  it('skips nameless rows with a numbered warning', () => {
    const res = parseSpecialistPaste('Name,Subject\n,Art\nOk,PE');
    expect(res.rows).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/Row 2 skipped/);
  });
});

describe('normalizeSubject', () => {
  it('maps common spellings onto the wizard\'s subjects', () => {
    expect(normalizeSubject('physical education')).toBe('PE');
    expect(normalizeSubject('Computer Lab')).toBe('Tech');
    expect(normalizeSubject('librarian')).toBe('Library');
    expect(normalizeSubject('STEM')).toBe('STEAM');
  });
  it('passes an unknown subject through untouched', () => {
    expect(normalizeSubject('Hula')).toBe('Hula');
    expect(normalizeSubject('')).toBe('');
  });
});
