// Shared roster-upload helpers for the Teachers and Specialists steps.

/** Extensions both roster importers accept. */
export const ROSTER_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls';

const APPLE_EXTS = new Set(['numbers', 'pages', 'key']);

/**
 * Apple's iWork files are zip bundles, not spreadsheets — dropping one in
 * produced a bare "not a CSV" error and a coordinator who couldn't tell what
 * to do next ("Didn't see csv on my desktop… it worked when I resaved as an
 * export csv from Apple's NUMBERS"). Returns the fix, or null.
 */
export function appleFormatHint(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (!APPLE_EXTS.has(ext)) return null;
  return `.${ext} files can't be read directly. In Numbers choose File → Export To → CSV, or just copy the table and paste it below.`;
}

/** True when the file extension is one of the roster formats we can read. */
export function isSupportedRosterFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return ['csv', 'tsv', 'txt', 'xlsx', 'xls'].includes(ext);
}
