// FilterRail — the left pane of the schedule's three-pane rhythm. Hosts the week
// cycle selector, entity filters, and density. Sticky on desktop; on mobile it
// collapses into a horizontally-scrolling strip so the grid keeps the width.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FilterRailSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      {title && (
        <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      )}
      {children}
    </div>
  );
}

interface FilterRailProps {
  children: ReactNode;
  className?: string;
}

export default function FilterRail({ children, className }: FilterRailProps) {
  return (
    <aside
      aria-label="Filters"
      className={cn(
        "no-print shrink-0 lg:w-60 lg:sticky lg:top-4 lg:self-start",
        className,
      )}
    >
      <div className="rounded-xl border border-border bg-card p-3 lg:p-4 space-y-4">
        {children}
      </div>
    </aside>
  );
}
