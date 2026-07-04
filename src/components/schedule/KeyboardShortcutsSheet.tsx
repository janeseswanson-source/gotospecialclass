// A compact reference of the Master Schedule keyboard shortcuts, opened with "?".
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["⌘", "K"], action: "Open the command palette" },
  { keys: ["?"], action: "Show this shortcuts reference" },
  { keys: ["⌘", "Z"], action: "Undo the last change" },
  { keys: ["⌘", "⇧", "Z"], action: "Redo" },
  { keys: ["Enter"], action: "Pick up / drop the focused block" },
  { keys: ["↑", "↓", "←", "→"], action: "Move a picked-up block between slots" },
  { keys: ["Esc"], action: "Cancel a move or close a panel" },
];

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.4rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

export default function KeyboardShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-border">
          {SHORTCUTS.map((s) => (
            <li key={s.action} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="text-muted-foreground">{s.action}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, i) => <Keycap key={i}>{k}</Keycap>)}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
