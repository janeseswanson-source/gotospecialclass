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
};

function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function warningMeta(type?: string | null): WarningMeta {
  if (!type) return { label: "Note", Icon: AlertTriangle };
  return META[type] ?? { label: titleCase(type), Icon: AlertTriangle };
}
