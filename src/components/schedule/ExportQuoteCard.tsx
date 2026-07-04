// "Quote for this export" card — shows the latest AI quote for the school, lets an
// admin Regenerate (generate-quote), edit the text, and pick the audience. The
// chosen text is lifted to the parent (onQuoteChange) and flows into the PDF
// footer band + the XLSX subtitle band on every sheet. Graceful no-key fallback:
// generateQuote rotates our static list.
import { useEffect, useRef, useState } from "react";
import { Quote, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateQuote, resolveDisplayQuote, type Audience } from "@/lib/quoteService";

interface Props {
  schoolId: string | null | undefined;
  /** Lifts the chosen quote text to the parent so exports can embed it. */
  onQuoteChange: (text: string) => void;
}

export default function ExportQuoteCard({ schoolId, onQuoteChange }: Props) {
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<Audience>("teachers");
  const [busy, setBusy] = useState(false);
  const seededFor = useRef<string | null>(null);

  // Load the latest persisted quote once per school.
  useEffect(() => {
    if (!schoolId || seededFor.current === schoolId) return;
    seededFor.current = schoolId;
    (async () => {
      const q = await resolveDisplayQuote(schoolId);
      setText(q.text);
      onQuoteChange(q.text);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  async function regenerate() {
    if (!schoolId || busy) return;
    setBusy(true);
    try {
      const q = await generateQuote(schoolId, audience);
      setText(q.text);
      onQuoteChange(q.text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/15 text-accent"><Quote className="h-3.5 w-3.5" /></span>
          <div>
            <p className="text-sm font-semibold text-foreground">Quote for this export</p>
            <p className="text-[11px] text-muted-foreground">Prints in the PDF footer and every spreadsheet sheet.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={regenerate} disabled={!schoolId || busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerate
        </Button>
      </div>
      <Tabs value={audience} onValueChange={(v) => setAudience(v as Audience)}>
        <TabsList className="h-7">
          <TabsTrigger value="teachers" className="text-[11px] h-6 px-2">Teachers</TabsTrigger>
          <TabsTrigger value="students" className="text-[11px] h-6 px-2">Students</TabsTrigger>
          <TabsTrigger value="both" className="text-[11px] h-6 px-2">Both</TabsTrigger>
        </TabsList>
      </Tabs>
      <Textarea
        value={text}
        onChange={(e) => { setText(e.target.value); onQuoteChange(e.target.value); }}
        rows={2}
        maxLength={240}
        placeholder="A motivational line for this export…"
        className="text-sm italic"
      />
    </div>
  );
}
