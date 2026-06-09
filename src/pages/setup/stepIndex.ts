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
