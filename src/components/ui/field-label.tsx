import * as React from "react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface FieldLabelProps extends React.ComponentPropsWithoutRef<typeof Label> {
  tooltip?: string;
  children: React.ReactNode;
}

const FieldLabel = React.forwardRef<HTMLLabelElement, FieldLabelProps>(
  ({ tooltip, children, className, ...props }, ref) => (
    <Label ref={ref} className={cn("inline-flex items-center gap-1", className)} {...props}>
      {children}
      {tooltip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3 w-3 text-muted-foreground/50 cursor-help shrink-0" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[220px] text-xs font-normal">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      )}
    </Label>
  )
);

FieldLabel.displayName = "FieldLabel";

export { FieldLabel };
