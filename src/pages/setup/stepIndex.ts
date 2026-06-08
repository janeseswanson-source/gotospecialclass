// Centralized setup wizard step indices.
// Keep in sync with stepComponents / stepLabels in SetupWizardContent.tsx.
export const SETUP_STEPS = {
  WELCOME: 0,
  SCHOOL_INFO: 1,
  CALENDAR: 2,
  RECESS_LUNCH: 3,
  SPECIALISTS: 4,
  TEACHERS: 5,
  ADMIN_ROTATION: 6,
  CLUBS: 7,
  EVENTS: 8,
  CONFLICTS: 9,
  REVIEW: 10,
} as const;

export type SetupStepKey = keyof typeof SETUP_STEPS;
export type SetupStepIndex = (typeof SETUP_STEPS)[SetupStepKey];
