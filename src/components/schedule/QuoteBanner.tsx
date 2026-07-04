import { useState } from "react";
import { Quote, RefreshCw, Loader2 } from "lucide-react";
import { generateQuote } from "@/lib/quoteService";

interface QuoteBannerProps {
  text: string;
  author: string;
  /** When set (with canRegenerate), shows a small "New quote" button for admins
   *  that asks the AI for a fresh original line and swaps it in. */
  schoolId?: string | null;
  canRegenerate?: boolean;
}

export default function QuoteBanner({ text, author, schoolId, canRegenerate }: QuoteBannerProps) {
  const [q, setQ] = useState({ text, author });
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    if (!schoolId || busy) return;
    setBusy(true);
    try {
      setQ(await generateQuote(schoolId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-primary p-5 text-primary-foreground">
      {/* Gold rule accent to tie the banner to the brand identity. */}
      <div className="absolute inset-x-0 top-0 h-1 bg-accent" aria-hidden />
      <Quote className="absolute right-4 top-3 h-12 w-12 text-accent opacity-25" aria-hidden />
      <p className="text-sm font-medium italic leading-relaxed pr-10">"{q.text}"</p>
      <div className="mt-1 flex items-center gap-3">
        <p className="text-xs opacity-80">— {q.author}</p>
        {canRegenerate && schoolId && (
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full border border-primary-foreground/30 px-2 py-0.5 text-[11px] font-medium opacity-90 hover:bg-primary-foreground/10 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
            New quote
          </button>
        )}
      </div>
    </div>
  );
}
