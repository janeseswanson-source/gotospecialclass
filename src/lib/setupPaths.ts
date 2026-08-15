// The ways into setup, described once.
//
// The paper template was described four different ways across the Welcome step
// and the Dashboard, and the Dashboard never mentioned the AI path at all —
// which is how a coordinator ends up asking "Maybe too many choices?" and
// "Does this have everything? Not sure. Maybe this is just a prep page?"
//
// Two primary paths, one secondary. Every surface reads from here.

export interface SetupPath {
  id: 'ai' | 'manual';
  title: string;
  /** One line. What actually happens if you pick this. */
  blurb: string;
}

export const SETUP_PATHS: SetupPath[] = [
  {
    id: 'ai',
    title: 'Set up with AI',
    blurb: 'Drop in your specialist and teacher lists — we fill in the wizard for you.',
  },
  {
    id: 'manual',
    // Her word, replacing "Fill each section yourself — full control, in any
    // order", which she struck out on the printout.
    title: 'Manually',
    blurb: 'Go through the wizard section by section.',
  },
];

/**
 * The paper prep sheet. Deliberately NOT a third primary choice — it's the
 * same wizard, reached on paper.
 *
 * `blurb` is honest about scope: uploading it fills in the School Info answers,
 * and the coordinator still adds specialists, teachers and bell times in the
 * wizard. Claiming it "pre-fills the wizard" set an expectation the parser
 * doesn't meet.
 */
export const PREP_SHEET_PATH = {
  title: 'Prefer to work on paper?',
  blurb:
    'Print the prep sheet, fill it in (or hand it to your specialists), then upload it. ' +
    "It fills in your School Info answers — you'll still add specialists, teachers and bell times in the wizard.",
  downloadLabel: 'Download the prep sheet',
  uploadLabel: 'Upload a filled sheet',
  uploadHref: '/app/coordinator-prep',
} as const;
