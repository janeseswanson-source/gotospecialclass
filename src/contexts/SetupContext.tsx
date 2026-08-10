import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSetupDraft, type SetupDraft } from '@/hooks/useSetupDraft';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';

export interface CalendarEvent {
  id: string;
  type: string;
  title: string;
  date: string;
  endDate: string;
  aiExtracted?: boolean;
}

export interface SchoolSetupData {
  schoolName: string;
  website: string;
  startTime: string;
  endTime: string;
  rotationsStartTime: string;
  planningTimeWhen: string;
  /** Contractual teacher duty day — blank means "same as the student day". */
  teacherDayStartTime: string;
  teacherDayEndTime: string;
  teacherPlanningBlockMinutes: number | '';
  teacherPlanningBlockWhen: string;
  /** First day the specials wheel runs (blank = same as the first student day). */
  rotationsStartDate: string;
  /** 'school_year' | 'rotations_start' — which week counts as Week A. */
  rotationsWeekAnchor: string;
  classDuration: number;
  planningMinutes: number;
  lunchMinutes: number;
  passingTime: number;
  setupTime: number;
  gradeTimeConfig: Record<string, { passingTime?: number; resetTime?: number }>;
  schoolYear: string;
  /** Explicit first/last instructional day (ISO "YYYY-MM-DD"). Optional — the
   *  week cycle falls back to parsing `schoolYear` when these are blank. */
  schoolYearStart: string;
  schoolYearEnd: string;
  notes: string;
  gradesServed: string[];
  scheduleType: 'whole_school' | 'staggered';
  recessConfig: Record<string, {
    amRecessStart: string; amRecessEnd: string;
    lunchStart: string; lunchEnd: string;
    pmRecessStart: string; pmRecessEnd: string;
    earlyReleaseLunchStart?: string; earlyReleaseLunchEnd?: string;
    earlyReleaseAmRecessStart?: string; earlyReleaseAmRecessEnd?: string;
    earlyReleasePmRecessStart?: string; earlyReleasePmRecessEnd?: string;
  }>;
  conflictStrategy: string;
  conflictStrategies: string[];
  conflictGrades: string[];
  conflictTiming: 'before' | 'after';
  earlyReleaseDay: string;
  earlyReleaseEndTime: string;
  adminRotation: { day: string; startTime: string; endTime: string; grades: string[]; autoSchedule?: boolean; durationMinutes?: number; rotationLabel?: string; weekLabel?: 'A' | 'B' | null }[];
  bigGroupConfig: Array<{ grade: string; teacherIds: string[] }>;
  defaultAmPmPreference: string;
  defaultDayPreference: string;
  makeupPolicy: string;
  gradePreference: 'keep_together' | 'waterfall' | 'fixed_sequence' | '';
}

export interface PrefilledTeacher {
  name: string;
  grade: string;
  room: string;
  phone: string;
  email: string;
  team: string;
}

export interface PrefilledSpecialist {
  name: string;
  subject: string;
  days: string[];
  planningMinutes: number | null;
  lunchMinutes: number | null;
  location: string;
  usesCart: boolean;
  twoSchools: boolean;
  secondSchoolName: string;
  secondLocation: string;
}

const defaultData: SchoolSetupData = {
  schoolName: '',
  website: '',
  startTime: '08:00',
  endTime: '15:00',
  rotationsStartTime: '',
  planningTimeWhen: 'during_rotations',
  teacherDayStartTime: '',
  teacherDayEndTime: '',
  teacherPlanningBlockMinutes: '',
  teacherPlanningBlockWhen: 'end_of_day',
  rotationsStartDate: '',
  rotationsWeekAnchor: 'school_year',
  classDuration: 45,
  planningMinutes: 45,
  lunchMinutes: 30,
  passingTime: 5,
  setupTime: 15,
  gradeTimeConfig: {},
  schoolYear: '2025-2026',
  schoolYearStart: '',
  schoolYearEnd: '',
  notes: '',
  gradesServed: [],
  scheduleType: 'whole_school',
  recessConfig: {
    all: { amRecessStart: '10:00', amRecessEnd: '10:15', lunchStart: '12:00', lunchEnd: '12:30', pmRecessStart: '14:00', pmRecessEnd: '14:15' },
  },
  conflictStrategy: 'standard',
  conflictStrategies: [],
  conflictGrades: [],
  conflictTiming: 'before',
  earlyReleaseDay: '',
  earlyReleaseEndTime: '',
  adminRotation: [],
  bigGroupConfig: [],
  defaultAmPmPreference: '',
  defaultDayPreference: '',
  makeupPolicy: '',
  gradePreference: '',
};

interface SetupContextType {
  step: number;
  setStep: (s: number) => void;
  data: SchoolSetupData;
  updateData: (partial: Partial<SchoolSetupData>) => void;
  schoolId: string | null;
  setSchoolId: (id: string | null) => void;
  visitedSteps: Set<number>;
  markStepVisited: (s: number) => void;
  prefilledTeachers: PrefilledTeacher[];
  setPrefilledTeachers: (t: PrefilledTeacher[]) => void;
  prefilledSpecialists: PrefilledSpecialist[];
  setPrefilledSpecialists: (s: PrefilledSpecialist[]) => void;
  calendarEvents: CalendarEvent[];
  setCalendarEvents: (events: CalendarEvent[]) => void;
  calendarUploadId: string | null;
  setCalendarUploadId: (id: string | null) => void;
  calendarParsed: boolean;
  setCalendarParsed: (p: boolean) => void;
  calendarFileName: string | null;
  setCalendarFileName: (name: string | null) => void;
  /** An unfinished local draft found on mount (offered, never auto-applied). */
  draftAvailable: SetupDraft<SchoolSetupData> | null;
  restoreDraft: () => void;
  discardDraft: () => void;
  clearDraft: () => void;
}

const SetupContext = createContext<SetupContextType | undefined>(undefined);

export const SetupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { selectedSchoolId, workspaceId } = useSchool();
  const [step, setStepRaw] = useState(0);
  const [data, setData] = useState<SchoolSetupData>(defaultData);
  const [schoolId, setSchoolId] = useState<string | null>(selectedSchoolId);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  const [prefilledTeachers, setPrefilledTeachers] = useState<PrefilledTeacher[]>([]);
  const [prefilledSpecialists, setPrefilledSpecialists] = useState<PrefilledSpecialist[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarUploadId, setCalendarUploadId] = useState<string | null>(null);
  const [calendarParsed, setCalendarParsed] = useState(false);
  const [calendarFileName, setCalendarFileName] = useState<string | null>(null);

  // Hydrate schoolId from the globally-selected school so steps work even when
  // the user lands directly on a tab other than School Info.
  useEffect(() => {
    if (selectedSchoolId && selectedSchoolId !== schoolId) {
      setSchoolId(selectedSchoolId);
    }
  }, [selectedSchoolId, schoolId]);

  // One-shot prefill from coordinator_prep on first mount per session.
  const prepSeededRef = useRef(false);
  useEffect(() => {
    if (prepSeededRef.current || !workspaceId) return;
    prepSeededRef.current = true;
    (async () => {
      try {
        let q = supabase.from('coordinator_prep').select('*').eq('workspace_id', workspaceId);
        q = selectedSchoolId ? q.eq('school_id', selectedSchoolId) : q.is('school_id', null);
        const { data: prep } = await q.maybeSingle();
        if (!prep) return;
        setData(prev => {
          const seed: Partial<SchoolSetupData> = {};
          if (!prev.earlyReleaseDay && prep.early_release_day) seed.earlyReleaseDay = prep.early_release_day;
          if (!prev.earlyReleaseEndTime && prep.early_release_end_time) seed.earlyReleaseEndTime = prep.early_release_end_time;
          if (!prev.gradePreference && (prep.grade_preference === 'keep_together' || prep.grade_preference === 'waterfall' || prep.grade_preference === 'fixed_sequence')) {
            seed.gradePreference = prep.grade_preference as 'keep_together' | 'waterfall' | 'fixed_sequence';
          }
          if (!prev.defaultAmPmPreference && prep.am_pm_preference) seed.defaultAmPmPreference = prep.am_pm_preference;
          if (!prev.defaultDayPreference && Array.isArray(prep.day_preference) && prep.day_preference.length) {
            seed.defaultDayPreference = prep.day_preference.join(',');
          }
          return Object.keys(seed).length ? { ...prev, ...seed } : prev;
        });
      } catch (err) {
        console.warn('[PrepPrefill] failed to seed setup data', err);
      }
    })();
  }, [workspaceId, selectedSchoolId]);

  // Hydrate setup data from the schools row so steps work even when the user
  // lands directly on a tab other than School Info. Only seeds fields still at
  // defaults to avoid clobbering in-flight edits.
  const schoolSeededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!schoolId || schoolSeededRef.current === schoolId) return;
    schoolSeededRef.current = schoolId;
    (async () => {
      try {
        const { data: school } = await supabase
          .from('schools')
          .select('name, website, start_time, end_time, grades_served, schedule_type, school_year, class_duration, planning_minutes, lunch_minutes, passing_time, setup_time, notes, early_release_day, early_release_end_time, default_am_pm_preference, default_day_preference, conflict_strategies, conflict_strategy, conflict_grades, conflict_timing, big_group_config')
          .eq('id', schoolId)
          .maybeSingle();
        if (!school) return;
        setData(prev => {
          const seed: Partial<SchoolSetupData> = {};
          if (!prev.schoolName && school.name) seed.schoolName = school.name;
          if (!prev.website && school.website) seed.website = school.website;
          if (Array.isArray(school.grades_served) && school.grades_served.length && prev.gradesServed.length === 0) {
            seed.gradesServed = school.grades_served as string[];
          }
          if (school.schedule_type) seed.scheduleType = school.schedule_type as 'whole_school' | 'staggered';
          if (school.start_time) seed.startTime = String(school.start_time).slice(0, 5);
          if (school.end_time) seed.endTime = String(school.end_time).slice(0, 5);
          if (school.school_year) seed.schoolYear = school.school_year;
          if ((school as { school_year_start?: string | null }).school_year_start) {
            seed.schoolYearStart = String((school as { school_year_start?: string | null }).school_year_start).slice(0, 10);
          }
          if ((school as { school_year_end?: string | null }).school_year_end) {
            seed.schoolYearEnd = String((school as { school_year_end?: string | null }).school_year_end).slice(0, 10);
          }
          if (typeof school.class_duration === 'number') seed.classDuration = school.class_duration;
          if (typeof school.planning_minutes === 'number') seed.planningMinutes = school.planning_minutes;
          if (typeof school.lunch_minutes === 'number') seed.lunchMinutes = school.lunch_minutes;
          if (typeof school.passing_time === 'number') seed.passingTime = school.passing_time;
          if (typeof school.setup_time === 'number') seed.setupTime = school.setup_time;
          if (!prev.notes && school.notes) seed.notes = school.notes;
          if (!prev.earlyReleaseDay && school.early_release_day) seed.earlyReleaseDay = school.early_release_day;
          if (!prev.earlyReleaseEndTime && school.early_release_end_time) {
            seed.earlyReleaseEndTime = String(school.early_release_end_time).slice(0, 5);
          }
          // Teacher duty day (migration 20260808010000 — may be unapplied, so
          // read through a narrow structural view rather than the generated types).
          const td = school as {
            teacher_day_start_time?: string | null;
            teacher_day_end_time?: string | null;
            teacher_planning_block_minutes?: number | null;
            teacher_planning_block_when?: string | null;
          };
          if (!prev.teacherDayStartTime && td.teacher_day_start_time) {
            seed.teacherDayStartTime = String(td.teacher_day_start_time).slice(0, 5);
          }
          if (!prev.teacherDayEndTime && td.teacher_day_end_time) {
            seed.teacherDayEndTime = String(td.teacher_day_end_time).slice(0, 5);
          }
          if (prev.teacherPlanningBlockMinutes === '' && typeof td.teacher_planning_block_minutes === 'number') {
            seed.teacherPlanningBlockMinutes = td.teacher_planning_block_minutes;
          }
          if (td.teacher_planning_block_when) {
            seed.teacherPlanningBlockWhen = td.teacher_planning_block_when;
          }
          const rc = school as { rotations_start_date?: string | null; rotations_week_anchor?: string | null };
          if (!prev.rotationsStartDate && rc.rotations_start_date) {
            seed.rotationsStartDate = String(rc.rotations_start_date).slice(0, 10);
          }
          if (rc.rotations_week_anchor) seed.rotationsWeekAnchor = rc.rotations_week_anchor;
          if (!prev.defaultAmPmPreference && school.default_am_pm_preference) {
            seed.defaultAmPmPreference = school.default_am_pm_preference;
          }
          if (!prev.defaultDayPreference && school.default_day_preference) {
            seed.defaultDayPreference = school.default_day_preference;
          }
          // Conflict strategy hydration — fixes checklist asking to reselect after reload
          const persistedStrats = (school as any).conflict_strategies as string[] | null;
          if (prev.conflictStrategies.length === 0) {
            if (Array.isArray(persistedStrats) && persistedStrats.length > 0) {
              seed.conflictStrategies = persistedStrats;
            } else if (school.conflict_strategy && school.conflict_strategy !== 'standard') {
              seed.conflictStrategies = [school.conflict_strategy];
            }
          }
          if (school.conflict_strategy && prev.conflictStrategy === 'standard') {
            seed.conflictStrategy = school.conflict_strategy;
          }
          if (Array.isArray(school.conflict_grades) && prev.conflictGrades.length === 0) {
            seed.conflictGrades = school.conflict_grades as string[];
          }
          if (school.conflict_timing && (school.conflict_timing === 'before' || school.conflict_timing === 'after')) {
            seed.conflictTiming = school.conflict_timing;
          }
          const bg = (school as any).big_group_config as Array<{ grade: string; teacherIds: string[] }> | null;
          if (Array.isArray(bg) && prev.bigGroupConfig.length === 0) {
            seed.bigGroupConfig = bg;
          }
          return Object.keys(seed).length ? { ...prev, ...seed } : prev;
        });
      } catch (err) {
        console.warn('[SchoolHydrate] failed to seed setup data from schools row', err);
      }
    })();
  }, [schoolId]);

  const setStep = useCallback((s: number) => {
    setStepRaw(s);
    setVisitedSteps(prev => {
      const next = new Set(prev);
      next.add(s);
      return next;
    });
  }, []);

  const markStepVisited = useCallback((s: number) => {
    setVisitedSteps(prev => {
      const next = new Set(prev);
      next.add(s);
      return next;
    });
  }, []);

  const updateData = useCallback((partial: Partial<SchoolSetupData>) => {
    setData(prev => ({ ...prev, ...partial }));
  }, []);

  // Local safety net: a failed save or a closed tab must not erase the
  // session. Offered back on mount; never applied silently.
  const draft = useSetupDraft<SchoolSetupData>(workspaceId, schoolId, data, step);

  const restoreDraft = useCallback(() => {
    const d = draft.restore();
    if (!d) return;
    setData(d.data);
    setStepRaw(d.step);
    setVisitedSteps(prev => new Set([...prev, d.step]));
  }, [draft]);

  return (
    <SetupContext.Provider value={{
      step, setStep, data, updateData, schoolId, setSchoolId,
      visitedSteps, markStepVisited,
      prefilledTeachers, setPrefilledTeachers,
      prefilledSpecialists, setPrefilledSpecialists,
      calendarEvents, setCalendarEvents,
      calendarUploadId, setCalendarUploadId,
      calendarParsed, setCalendarParsed,
      calendarFileName, setCalendarFileName,
      draftAvailable: draft.available,
      restoreDraft,
      discardDraft: draft.discard,
      clearDraft: draft.clear,
    }}>
      {children}
    </SetupContext.Provider>
  );
};

export const useSetup = () => {
  const ctx = useContext(SetupContext);
  if (!ctx) throw new Error('useSetup must be used within SetupProvider');
  return ctx;
};
