import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
interface ExportCardProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  format: string;
  disabled?: boolean;
  onExport?: () => void;
}

export default function ExportCard({ title, description, icon: Icon, format, disabled, onExport }: ExportCardProps) {
  return (
    <div className={cn(
      "flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-shadow",
      disabled ? "opacity-50" : "hover:shadow-md",
    )}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
          {format}
        </span>
      </div>
      <Button size="sm" variant="outline" disabled={disabled} onClick={onExport}>
        <Download className="h-3.5 w-3.5 mr-1" />
        Export
      </Button>
    </div>
  );
}
