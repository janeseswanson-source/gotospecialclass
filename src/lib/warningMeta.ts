// Friendly labels + icons for schedule warning types coming out of
// supabase/functions/generate-schedule. Unknown types fall back to a
// title-cased version of the raw type string.
import {
  AlertTriangle, Calendar, ClipboardList, Clock, FileText,
  GraduationCap, Layers, ScrollText, Users, Coffee, Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface WarningMeta {
  label: string;
  Icon: LucideIcon;
}

const META: Record<string, WarningMeta> = {
  // Existing engine warnings
  no_coverage:                    { label: "No Coverage",            Icon: GraduationCap },
  double_booked:                  { label: "Double Booked",          Icon: AlertTriangle },
  planning_shortfall:             { label: "Planning Shortfall",     Icon: Clock },
  extra_rotation_failed:          { label: "Extra Rotation Failed",  Icon: Layers },
  calendar_conflict:              { label: "Calendar Conflict",      Icon: Calendar },
  one_off_no_school:              { label: "No-School Date",         Icon: Calendar },

  // New: scheduler-data integration warnings
  grade_cohesion:                 { label: "Grade Cohesion",         Icon: Users },
  extra_plt_below_target:         { label: "Extra PLT Below Target", Icon: Sparkles },
  contractual_subject_shortfall:  { label: "Contract: Subject",      Icon: ScrollText },
  contractual_planning_shortfall: { label: "Contract: Planning",     Icon: ClipboardList },
  contractual_duty_free_shortfall:{ label: "Contract: Duty-Free",    Icon: Coffee },
  contractual_role_unmatched:     { label: "Contract: Role",         Icon: FileText },

  // Engine warnings that had no entry and were rendering as raw type strings.
  teacher_double_booked:          { label: "Class Double Booked",    Icon: AlertTriangle },
  teacher_no_coverage:            { label: "Class Has No Specials",  Icon: GraduationCap },
  capacity_shortfall:             { label: "Not Enough Capacity",    Icon: Layers },
  skipped_holiday:                { label: "Skipped Holiday",        Icon: Calendar },
  calendar_one_off:               { label: "One-Off Date",           Icon: Calendar },

  // Teacher-team time: the cap and the target (see _teamtime.ts).
  team_out_stretch:               { label: "Teachers Out Too Long",  Icon: Clock },
  grade_pd_short:                 { label: "Short Grade PD Window",  Icon: Users },
  grade_pd_infeasible:            { label: "Grade PD Not Possible",  Icon: Users },
  grade_over_rotation:            { label: "Over-Rotated Grade",     Icon: Layers },
  teacher_day_misconfigured:      { label: "Teacher Day Setup",      Icon: Clock },
  accompanied_planning_gap:       { label: "Teacher Stays With Class", Icon: Users },
};

function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** True when `type` has a hand-written entry (not just the title-case
 *  fallback). Used by the coverage guard in warningMeta.test.ts — a label that
 *  happens to equal its fallback ("No Coverage") is still explicit. */
export function hasExplicitWarningMeta(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(META, type);
}

export function warningMeta(type?: string | null): WarningMeta {
  if (!type) return { label: "Note", Icon: AlertTriangle };
  return META[type] ?? { label: titleCase(type), Icon: AlertTriangle };
}
