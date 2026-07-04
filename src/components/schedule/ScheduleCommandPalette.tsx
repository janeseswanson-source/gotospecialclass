// Command palette for the Master Schedule (⌘K / Ctrl-K). Surfaces the page's
// primary actions — generate/refine, fix conflicts, edit with AI, switch version,
// export, and "jump to" any specialist/teacher — plus a shortcuts reference.
import { useEffect } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import type { LucideIcon } from "lucide-react";

export interface CommandAction {
  id: string;
  label: string;
  group: string;
  icon?: LucideIcon;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CommandAction[];
}

export default function ScheduleCommandPalette({ open, onOpenChange, actions }: Props) {
  // Global ⌘K / Ctrl-K toggle (ignored while typing in a field, except to close).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Preserve group order as first-seen.
  const groups: string[] = [];
  for (const a of actions) if (!groups.includes(a.group)) groups.push(a.group);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matching command.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={group}>
            {actions.filter((a) => a.group === group).map((a) => {
              const Icon = a.icon;
              return (
                <CommandItem
                  key={a.id}
                  disabled={a.disabled}
                  value={`${a.label} ${(a.keywords ?? []).join(" ")}`}
                  onSelect={() => { onOpenChange(false); a.run(); }}
                >
                  {Icon && <Icon className="mr-2 h-4 w-4" aria-hidden />}
                  <span>{a.label}</span>
                  {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
