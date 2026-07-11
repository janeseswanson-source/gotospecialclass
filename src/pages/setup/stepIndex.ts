// Centralized setup wizard step indices.
// Keep in sync with STEPS in SetupWizardContent.tsx.
export const SETUP_STEPS = {
  WELCOME: 0,
  SCHOOL_INFO: 1,
  CALENDAR: 2,
  RECESS_LUNCH: 3,
  SPECIALISTS: 4,
  TEACHERS: 5,
  CONTRACTUAL_MINUTES: 6,
  ADMIN_ROTATION: 7,
  CLUBS: 8,
  EVENTS: 9,
  CONFLICTS: 10,
  REVIEW: 11,
} as const;

export type SetupStepKey = keyof typeof SETUP_STEPS;
export type SetupStepIndex = (typeof SETUP_STEPS)[SetupStepKey];

// The happy path: these seven steps are all a coordinator MUST touch before
// generating. The five extras are grouped behind one collapsible rail entry
// and chain among themselves (Calendar → Contractual Minutes → Admin Rotation
// → Clubs → Events → Conflicts). Step INDICES never change — only the order
// they're presented in.
export const REQUIRED_STEP_ORDER: number[] = [
  SETUP_STEPS.WELCOME,
  SETUP_STEPS.SCHOOL_INFO,
  SETUP_STEPS.RECESS_LUNCH,
  SETUP_STEPS.SPECIALISTS,
  SETUP_STEPS.TEACHERS,
  SETUP_STEPS.CONFLICTS,
  SETUP_STEPS.REVIEW,
];

export const EXTRA_STEP_ORDER: number[] = [
  SETUP_STEPS.CALENDAR,
  SETUP_STEPS.CONTRACTUAL_MINUTES,
  SETUP_STEPS.ADMIN_ROTATION,
  SETUP_STEPS.CLUBS,
  SETUP_STEPS.EVENTS,
];
