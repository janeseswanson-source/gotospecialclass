import logo from "@/assets/logo.png";

interface Props {
  title: string;
  subtitle?: string;
  schoolName?: string;
  schoolYear?: string;
  right?: React.ReactNode;
}

/**
 * Branded header band used on every on-screen schedule page (Master Schedule,
 * Master Admin View, Lesson Planner, Specialist Planner). Mirrors the look of
 * the printable/PDF planner so on-screen and exported views feel like one
 * product. Navy text, gold rule, cream-on-white surface.
 */
export default function BrandedScheduleHeader({
  title,
  subtitle,
  schoolName,
  schoolYear,
  right,
}: Props) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-6 border-b-2 border-accent px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src={logo}
            alt="Specialist Ops! logo"
            className="h-11 w-11 rounded-lg object-cover shrink-0"
          />
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-primary leading-tight truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[11px] tracking-wider text-muted-foreground uppercase truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs space-y-0.5 min-w-[200px] hidden md:block">
            {schoolName && (
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground">School:</span>
                <span className="text-foreground font-medium truncate">
                  {schoolName}
                </span>
              </div>
            )}
            {schoolYear && (
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground">Year:</span>
                <span className="text-foreground font-medium">{schoolYear}</span>
              </div>
            )}
          </div>
          {right}
        </div>
      </div>
    </div>
  );
}
