import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Printer, FileText, LayoutGrid } from 'lucide-react';
import SpecialistExportModal from './SpecialistExportModal';
import AdminExportModal from './AdminExportModal';

interface Props {
  specialists: { id: string; name: string; subject: string }[];
  blocks: any[];
  schoolId?: string | null;
  schoolName?: string;
  schoolYear?: string;
  recessConfig?: any[];
  teachers?: any[];
  clubs?: any[];
}

export const PrintExportCard = ({ specialists, blocks, schoolId, schoolName, schoolYear, recessConfig, teachers, clubs }: Props) => {
  const [specOpen, setSpecOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const disabled = specialists.length === 0 || blocks.length === 0;

  const button = (label: string, icon: React.ReactNode, onClick: () => void) => {
    const btn = (
      <Button variant="outline" className="justify-start gap-2 w-full" disabled={disabled} onClick={onClick}>
        {icon}
        {label}
      </Button>
    );
    if (!disabled) return btn;
    return (
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0} className="block">{btn}</span></TooltipTrigger>
        <TooltipContent>Generate a schedule first.</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3 no-print">
        <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
          <Printer className="h-4 w-4" /> Print &amp; Export
        </h3>
        <div className="flex flex-col gap-2">
          {button('Specialist Weekly Planner (PDF)', <FileText className="h-4 w-4" />, () => setSpecOpen(true))}
          {button('Admin: All Rotations Overview (PDF)', <LayoutGrid className="h-4 w-4" />, () => setAdminOpen(true))}
        </div>
      </div>

      <SpecialistExportModal
        open={specOpen}
        onOpenChange={setSpecOpen}
        specialists={specialists}
        blocks={blocks}
        schoolId={schoolId}
        schoolName={schoolName}
        schoolYear={schoolYear}
        recessConfig={recessConfig}
      />
      <AdminExportModal
        open={adminOpen}
        onOpenChange={setAdminOpen}
        specialists={specialists}
        blocks={blocks}
        schoolId={schoolId}
        schoolName={schoolName}
        schoolYear={schoolYear}
        teachers={teachers}
        clubs={clubs}
        recessConfig={recessConfig}
      />
    </TooltipProvider>
  );
};

export default PrintExportCard;
