import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hasExplicitWarningMeta } from './warningMeta';

// Guard: every warning the engine can emit needs a friendly label, or the UI
// shows a raw snake_case type to a coordinator. Several types shipped without
// one (team_out_stretch, capacity_shortfall...) and nobody noticed, because
// the fallback title-cases the string and looks almost plausible.
const ENGINE_DIR = join(process.cwd(), 'supabase', 'functions', 'generate-schedule');

function engineWarningTypes(): string[] {
  const types = new Set<string>();
  for (const f of readdirSync(ENGINE_DIR)) {
    if (!f.endsWith('.ts') || f.includes('_test')) continue;
    const src = readFileSync(join(ENGINE_DIR, f), 'utf8');
    for (const m of src.matchAll(/\btype:\s*"([a-z0-9_]+)"/g)) types.add(m[1]);
  }
  return [...types].sort();
}

describe('warningMeta coverage', () => {
  it('finds the engine warning types (sanity)', () => {
    const types = engineWarningTypes();
    expect(types.length).toBeGreaterThan(8);
    expect(types).toContain('no_coverage');
  });

  it('every engine warning type has an explicit label', () => {
    const missing = engineWarningTypes().filter((t) => !hasExplicitWarningMeta(t));
    expect(
      missing,
      `These engine warning types have no entry in warningMeta.ts and will render as raw text:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});
