import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import ScheduleGrid from "./ScheduleGrid";
import { SAMPLE_BLOCKS, SAMPLE_TIMESLOTS, SAMPLE_RECESS } from "@/lib/sampleSchedule";
import { track } from "@/lib/observability";

/**
 * Read-only preview of a finished schedule so a brand-new user can see what
 * they're working toward before doing any setup. Uses static sample data —
 * nothing is saved, and the grid is non-interactive (no drag/drop, no edits).
 */
export default function SampleSchedulePreview({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) track("sample_schedule_viewed"); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Sample schedule</DialogTitle>
          <DialogDescription>
            This is an example of what a finished week looks like — four specialists rotating across
            grades K–5, with recess and lunch protected. Yours will be built from your own school's info.
          </DialogDescription>
        </DialogHeader>
        <ScheduleGrid
          blocks={SAMPLE_BLOCKS}
          timeSlots={SAMPLE_TIMESLOTS}
          recessBands={SAMPLE_RECESS}
        />
      </DialogContent>
    </Dialog>
  );
}
