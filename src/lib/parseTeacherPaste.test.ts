import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseTeacherPaste, inferTeamFromGrade } from './parseTeacherPaste';

describe('parseTeacherPaste — the shipped template', () => {
  // Read the REAL file the app hands users. The parser and the template drifted
  // apart once (`teacher_name`/`room_number` matched no header token, so the
  // header was detected, `name` never bound, and every row was dropped with
  // "skipped: no name" — the download imported zero teachers). Loading it as a
  // fixture makes that regression impossible to reintroduce silently.
  const csv = fs.readFileSync(
    path.resolve(process.cwd(), 'public/templates/teachers_template.csv'),
    'utf8',
  );

  it('imports every row with no warnings', () => {
    const res = parseTeacherPaste(csv);
    expect(res.headerDetected).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.rows.length).toBeGreaterThanOrEqual(2);
    expect(res.rows.every((r) => r.name.trim().length > 0)).toBe(true);
  });

  it('maps every labelled column, including snake_case ones', () => {
    const [first] = parseTeacherPaste(csv).rows;
    expect(first).toMatchObject({
      name: 'Jane Doe',
      grade: '1',
      room: '101',
      team: 'Grade 1 Team',
      phone: '555-0100',
      email: 'jane@school.edu',
    });
  });
});

describe('parseTeacherPaste — the simple two-column template', () => {
  // "Should we just be able to copy and paste a list? Add name and grade."
  const csv = fs.readFileSync(
    path.resolve(process.cwd(), 'public/templates/teachers_template_simple.csv'),
    'utf8',
  );

  it('imports name + grade with no warnings', () => {
    const res = parseTeacherPaste(csv);
    expect(res.headerDetected).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.rows).toHaveLength(3);
    expect(res.rows.map((r) => r.name)).toEqual(['Jane Doe', 'John Smith', 'Amy Wong']);
    expect(res.rows.map((r) => r.grade)).toEqual(['1', '2', 'K']);
  });
});

describe('parseTeacherPaste — header handling', () => {
  it('normalises separators and case in header cells', () => {
    const res = parseTeacherPaste('Teacher-Name\tGrade Level\tRoom #\nA Smith\t3\t204');
    expect(res.headerDetected).toBe(true);
    expect(res.rows[0]).toMatchObject({ name: 'A Smith', grade: '3', room: '204' });
  });

  it('strips a UTF-8 BOM off the first header cell', () => {
    const bom = String.fromCharCode(0xfeff);
    const res = parseTeacherPaste(`${bom}name,grade\nB Jones,K`);
    expect(res.headerDetected).toBe(true);
    expect(res.rows[0]).toMatchObject({ name: 'B Jones', grade: 'K' });
    // No warning proves the BOM'd cell was RECOGNISED as the name header,
    // rather than rescued by the positional fallback (which warns).
    expect(res.warnings).toEqual([]);
  });

  it('accepts a two-column header (matches >= 2 beats the percentage rule)', () => {
    const res = parseTeacherPaste('Name,Grade\nC Lee,2');
    expect(res.headerDetected).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].name).toBe('C Lee');
  });

  it('falls back to positional when a header binds no name column', () => {
    // "instructor" is not a token we know; grade/room are. Without the fallback
    // every row would be dropped.
    const res = parseTeacherPaste('instructor,grade,room\nD Park,4,301');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ name: 'D Park', grade: '4', room: '301' });
    expect(res.warnings.join(' ')).toMatch(/name/i);
  });

  it('still parses headerless positional data', () => {
    const res = parseTeacherPaste('E Ruiz,5,410');
    expect(res.headerDetected).toBe(false);
    expect(res.rows[0]).toMatchObject({ name: 'E Ruiz', grade: '5', room: '410' });
  });

  it('infers the team from the grade when absent', () => {
    const res = parseTeacherPaste('Name,Grade\nF Chan,K');
    expect(res.rows[0].team).toBe(inferTeamFromGrade('K'));
  });
});
