// Dev-only: render the blank prep sheet so its AcroForm fields can be checked.
//   npx vite-node scripts/preview-prep-pdf.tsx
import fs from 'node:fs';

(globalThis as any).window ??= { location: { origin: 'https://preview.local' } };

const { renderToBuffer } = await import('@react-pdf/renderer');
const { default: CoordinatorPrepDoc } = await import('../src/pdf/CoordinatorPrep');
const { BLANK_PREP_ROWS } = await import('../src/lib/downloadPrepSheet');

fs.mkdirSync('_debug', { recursive: true });
const buf = await renderToBuffer(
  <CoordinatorPrepDoc schoolName="King Kamehameha III Elementary" rows={BLANK_PREP_ROWS} fillable />,
);
fs.writeFileSync('_debug/prep-sheet-fillable.pdf', buf);
console.log(`wrote _debug/prep-sheet-fillable.pdf (${(buf.length / 1024).toFixed(0)} KB)`);
