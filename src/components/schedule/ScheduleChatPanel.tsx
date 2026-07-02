import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrainCircuit, X as XIcon, AlertCircle, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { PromptInput, PromptInputTextarea, PromptInputSubmit, PromptInputFooter } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import ApplyOpsBar, { opLabel, OpIcon, type OpsDelta } from "@/components/schedule/ApplyOpsBar";
import { toggleRejected, type PreviewOp, type ProposalItem } from "@/lib/ghostPreview";

// Quick prompts that showcase what the v2 assistant can actually do (engine
// tools: quality report, rebalance, conflict cascade, free-slot search).
const QUICK_PROMPTS = [
  "What's wrong with this schedule?",
  "Even out specialist workload across days",
  "Fix the subjects that double up on the same day",
  "Find a free Friday slot for 3rd grade Music and move it there",
];

interface ScheduleChatPanelProps {
  generationId: string | null;
  onClose: () => void;
  onScheduleChanged: () => void;
  /** Called after Apply with the ids of blocks that changed, so the page can
   *  highlight them in the grid. */
  onApplied?: (changedBlockIds: string[]) => void;
  /** Ghost preview: the accepted-but-unapplied ops, emitted whenever they change
   *  so the page can overlay them on the grid. Empty array clears the overlay. */
  onPreviewOps?: (ops: PreviewOp[]) => void;
}

/** Inline card for a proposed (or rejected) tool action — plain language, plus
 *  the measured quality delta for engine passes. */
function ProposalCard({ output }: { output: any }) {
  const ops: any[] = output?.op ? [output.op] : Array.isArray(output?.ops) ? output.ops : [];
  if (output?.status === "proposed" && ops.length > 0) {
    const delta = typeof output.quality_delta === "number" ? output.quality_delta : null;
    return (
      <div className="my-1.5 rounded-lg border border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs space-y-1">
        {ops.slice(0, 6).map((op, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-0.5 text-amber-700 dark:text-amber-400"><OpIcon kind={op.kind} /></span>
            <p className="min-w-0 flex-1 font-medium text-foreground">{opLabel(op)}</p>
          </div>
        ))}
        {ops.length > 6 && <p className="pl-6 text-[10px] text-muted-foreground">+ {ops.length - 6} more</p>}
        <p className="text-[10px] text-muted-foreground">
          Proposed — review and apply below.
          {delta !== null && <span className={delta >= 0 ? " text-success font-semibold" : " text-destructive font-semibold"}> {delta >= 0 ? `+${delta}` : delta} quality</span>}
        </p>
      </div>
    );
  }
  if (output?.ok === false && output?.error) {
    return (
      <div className="my-1.5 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-destructive">Couldn't make that change</p>
          <p className="text-[11px] text-muted-foreground">{String(output.error)}</p>
        </div>
      </div>
    );
  }
  return null;
}

export default function ScheduleChatPanel({ generationId, onClose, onScheduleChanged, onApplied, onPreviewOps }: ScheduleChatPanelProps) {
  const [hydratedMessages, setHydratedMessages] = useState<UIMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const tokenRef = useRef<string | null>(null);
  // Proposals the user has already applied or discarded (by toolCallId), so
  // they drop out of the pending Apply bar.
  const [resolvedCallIds, setResolvedCallIds] = useState<Set<string>>(new Set());
  const [rejectedItemIds, setRejectedItemIds] = useState<Set<string>>(new Set());
  const [skippedByItemId, setSkippedByItemId] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  // Compact before→after lines for the changes just applied (shown in the chat).
  const [appliedLines, setAppliedLines] = useState<string[]>([]);

  const transport = useMemo(() => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/schedule-chat`;
    return new DefaultChatTransport({
      api: url,
      body: { generation_id: generationId },
      headers: async () => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? tokenRef.current;
        if (!token) {
          throw new Error("You're signed out. Please sign in again to use the AI editor.");
        }
        tokenRef.current = token;
        return {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        };
      },
      fetch: async (input, init) => {
        try {
          const resp = await fetch(input as any, init);
          if (!resp.ok) {
            const body = await resp.clone().text().catch(() => "");
            console.error("[chat] server error body:", body);
          }
          return resp;
        } catch (err) {
          console.error("[chat] fetch threw", err);
          throw err;
        }
      },
    });
  }, [generationId]);

  // Hydrate persisted chat_history once per generation.
  useEffect(() => {
    if (!generationId) {
      setHydratedMessages([]);
      setHydrated(true);
      return;
    }
    let alive = true;
    setHydrated(false);
    (async () => {
      const { data } = await supabase
        .from("schedule_generations")
        .select("chat_history")
        .eq("id", generationId)
        .maybeSingle();
      if (!alive) return;
      const hist = Array.isArray((data as any)?.chat_history) ? ((data as any).chat_history as UIMessage[]) : [];
      setHydratedMessages(hist);
      // Proposals from earlier sessions were already applied or discarded back
      // then — treat them all as resolved so they don't reappear.
      const historicalCallIds = new Set<string>();
      for (const m of hist) {
        if ((m as any).role !== "assistant") continue;
        ((m as any).parts ?? []).forEach((part: any, idx: number) => {
          if (part?.type?.startsWith?.("tool-") && part.output?.status === "proposed") {
            historicalCallIds.add(part.toolCallId ?? `${m.id}-${idx}`);
          }
        });
      }
      setResolvedCallIds(historicalCallIds);
      setHydrated(true);
    })();
    return () => { alive = false; };
  }, [generationId]);

  const { messages, sendMessage, status, error, stop } = useChat({
    id: generationId ?? "no-gen",
    messages: hydratedMessages,
    transport,
    onError: (err) => {
      console.error("[schedule-chat] useChat error", err);
      toast({
        title: "AI editor error",
        description: err?.message ?? "The chat request failed. Check your connection and try again.",
        variant: "destructive",
      });
    },
    onFinish: () => {
      onScheduleChanged();
    },
  });

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (hydrated) textareaRef.current?.focus();
  }, [hydrated, status]);

  const isLoading = status === "submitted" || status === "streaming";
  const canSend = !!generationId && hydrated && !!input.trim() && !isLoading;

  // Pending proposals = tool outputs the AI returned with status "proposed" that
  // the user hasn't yet applied or discarded. Engine passes return `ops` arrays;
  // single-edit tools return one `op` — both flow into the same Apply bar.
  const pendingItems = useMemo<Array<ProposalItem & { callId: string }>>(() => {
    const out: Array<ProposalItem & { callId: string }> = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      m.parts.forEach((part: any, idx) => {
        if (!part?.type?.startsWith?.("tool-")) return;
        const output = part.output;
        if (!output || output.status !== "proposed") return;
        const callId = part.toolCallId ?? `${m.id}-${idx}`;
        if (resolvedCallIds.has(callId)) return;
        const ops: PreviewOp[] = output.op ? [output.op] : Array.isArray(output.ops) ? output.ops : [];
        ops.forEach((op, oi) => out.push({ id: `${callId}:${oi}`, callId, op }));
      });
    }
    return out;
  }, [messages, resolvedCallIds]);

  // Latest quality delta reported by preview_ops / an engine pass this turn.
  const latestDelta = useMemo<OpsDelta | null>(() => {
    let found: OpsDelta | null = null;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const part of (m.parts ?? []) as any[]) {
        if (!part?.type?.startsWith?.("tool-")) continue;
        const o = part.output;
        if (o && typeof o.quality_delta === "number") {
          found = { quality_delta: o.quality_delta, new_errors: o.new_errors, warnings_after: o.warnings_after, warnings_before: o.warnings_before };
        }
      }
    }
    return found;
  }, [messages]);

  const acceptedItems = useMemo(
    () => pendingItems.filter((p) => !rejectedItemIds.has(p.id)),
    [pendingItems, rejectedItemIds],
  );

  // Ghost preview: emit the accepted ops whenever they change (page overlays them).
  useEffect(() => {
    onPreviewOps?.(acceptedItems.map((p) => p.op));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedItems]);
  // Clear the overlay when the panel unmounts.
  useEffect(() => () => { onPreviewOps?.([]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function markResolved(callIds: string[]) {
    setResolvedCallIds((prev) => {
      const next = new Set(prev);
      callIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function applyChanges() {
    if (!generationId || applying || acceptedItems.length === 0) return;
    setApplying(true);
    setSkippedByItemId({});
    const ops = acceptedItems.map((p) => p.op);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? tokenRef.current;
      if (!token) throw new Error("You're signed out. Sign in again to apply changes.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-schedule-edits`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ generation_id: generationId, ops }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);

      // Map each skipped reason back to the proposal it belongs to (by block id).
      const skipped: string[] = Array.isArray(data.skipped) ? data.skipped : [];
      const skipMap: Record<string, string> = {};
      const appliedItems: Array<ProposalItem & { callId: string }> = [];
      for (const p of acceptedItems) {
        const op: any = p.op;
        const ids = [op.block_id, op.a_id, op.b_id].filter(Boolean) as string[];
        const reason = ids.length ? skipped.find((s) => ids.some((id) => s.includes(id))) : undefined;
        if (reason) skipMap[p.id] = reason.replace(/^[a-z]+\s+[0-9a-f-]+:\s*/i, "");
        else appliedItems.push(p);
      }
      // Resolve calls whose every op applied; keep partially-failed calls visible.
      const failedCallIds = new Set(Object.keys(skipMap).map((id) => id.split(":")[0]));
      markResolved([...new Set(appliedItems.map((p) => p.callId))].filter((c) => !failedCallIds.has(c)));
      setSkippedByItemId(skipMap);
      // Compact before→after line per applied op, shown in the chat.
      setAppliedLines(appliedItems.map((p) => opLabel(p.op)));

      onScheduleChanged();
      onPreviewOps?.([]);
      const changedIds: string[] = Array.isArray(data.changed_block_ids) ? data.changed_block_ids : [];
      if (changedIds.length) onApplied?.(changedIds);
      toast({
        title: skipped.length
          ? `Applied ${data.applied}, ${skipped.length} couldn't apply`
          : `Applied ${data.applied} change${data.applied === 1 ? "" : "s"}`,
        description: skipped.length ? "The items in red below couldn't be applied — see why." : "The schedule has been updated.",
        variant: skipped.length ? "destructive" : undefined,
      });
    } catch (e: any) {
      toast({ title: "Couldn't apply changes", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  }

  function discardChanges() {
    markResolved([...new Set(pendingItems.map((p) => p.callId))]);
    setRejectedItemIds(new Set());
    setSkippedByItemId({});
    onPreviewOps?.([]);
  }

  async function submit() {
    const text = input.trim();
    if (!text) return;
    if (!generationId) {
      toast({ title: "No schedule selected", description: "Generate a schedule first.", variant: "destructive" });
      return;
    }
    if (isLoading) {
      toast({ title: "Already sending", description: "Wait for the current response to finish." });
      return;
    }
    if (pendingItems.length) {
      const proceed = window.confirm(
        `You have ${pendingItems.length} unapplied change${pendingItems.length === 1 ? "" : "s"}. Sending a new message will discard ${pendingItems.length === 1 ? "it" : "them"}. Continue?`,
      );
      if (!proceed) return;
      discardChanges();
    }
    setAppliedLines([]);
    setInput("");
    try {
      await sendMessage({ text });
    } catch (err: any) {
      console.error("[chat] send failed", err);
      toast({
        title: "Couldn't send message",
        description: err?.message ?? "Network error reaching the AI editor.",
        variant: "destructive",
      });
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex h-full w-[min(540px,100vw)] flex-col border-l border-border bg-background shadow-2xl no-print">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BrainCircuit className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Edit with AI</p>
            <p className="text-xs text-muted-foreground">
              {generationId
                ? "Changes preview on the grid — nothing saves until you Apply."
                : "Generate a schedule first to start chatting."}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close AI editor">
          <XIcon className="h-4 w-4" />
        </Button>
      </header>

      <Conversation className="flex-1 min-h-0">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="An assistant that knows the rules"
              description="It can diagnose quality issues, find legal open slots, even out workloads, fix double-bookings with the smallest change, and preview every edit's quality impact before you apply. Try a suggestion below."
            />
          ) : (
            messages.map((m) => {
              const parts = (m.parts ?? []) as any[];
              const hasText = parts.some((p) => p.type === "text" && p.text?.trim());
              const proposedCount = parts.reduce((acc, p) => {
                if (!p.type?.startsWith?.("tool-") || p.output?.status !== "proposed") return acc;
                return acc + (p.output.op ? 1 : Array.isArray(p.output.ops) ? p.output.ops.length : 0);
              }, 0);
              const hasTool = parts.some((p) => p.type?.startsWith?.("tool-"));
              return (
                <Message key={m.id} from={m.role === "user" ? "user" : "assistant"}>
                  <MessageContent>
                    {m.parts.map((part, i) => {
                      if (part.type === "text") {
                        return m.role === "user" ? (
                          <p key={i} className="whitespace-pre-wrap">{part.text}</p>
                        ) : (
                          <MessageResponse key={i}>{part.text}</MessageResponse>
                        );
                      }
                      if (part.type?.startsWith("tool-")) {
                        const tp = part as any;
                        const card = tp.output ? <ProposalCard key={i} output={tp.output} /> : null;
                        if (card && (tp.output?.status === "proposed" || tp.output?.ok === false)) return card;
                        return (
                          <Tool key={i} defaultOpen={false} className="my-2">
                            <ToolHeader type={tp.type} state={tp.state} />
                            <ToolContent>
                              {tp.input && <ToolInput input={tp.input} />}
                              {(tp.output !== undefined || tp.errorText) && (
                                <ToolOutput output={tp.output} errorText={tp.errorText} />
                              )}
                            </ToolContent>
                          </Tool>
                        );
                      }
                      return null;
                    })}
                    {m.role === "assistant" && !hasText && !isLoading && (
                      hasTool ? (
                        <p className="text-xs text-foreground">
                          {proposedCount > 0
                            ? `I've proposed ${proposedCount} change${proposedCount === 1 ? "" : "s"} — review and Apply ${proposedCount === 1 ? "it" : "them"} below.`
                            : "Done — see the result above."}
                        </p>
                      ) : (
                        <p className="text-xs italic text-muted-foreground">
                          No response — please try again or rephrase.
                        </p>
                      )
                    )}
                  </MessageContent>
                </Message>
              );
            })
          )}
          {appliedLines.length > 0 && (
            <div className="mx-2 my-2 rounded-lg border border-success/40 bg-success/5 px-3 py-2 text-xs space-y-1">
              <p className="flex items-center gap-1.5 font-semibold text-success"><Check className="h-3.5 w-3.5" /> Applied</p>
              {appliedLines.map((l, i) => (
                <p key={i} className="pl-5 text-foreground">{l}</p>
              ))}
            </div>
          )}
          {isLoading && (
            <div className="px-2 py-1">
              <Shimmer>Thinking...</Shimmer>
            </div>
          )}
          {error && (
            <div className="mx-2 my-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">Chat error</div>
                <div className="opacity-90">{error.message}</div>
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {messages.length === 0 && generationId && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => { setInput(q); textareaRef.current?.focus(); }}
              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground hover:bg-muted"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {pendingItems.length > 0 && !isLoading && (
        <ApplyOpsBar
          items={pendingItems}
          rejectedIds={rejectedItemIds}
          onToggle={(id) => setRejectedItemIds((prev) => toggleRejected(prev, id))}
          skippedById={skippedByItemId}
          delta={latestDelta}
          applying={applying}
          onApply={applyChanges}
          onDiscard={discardChanges}
        />
      )}

      <div className="border-t border-border p-3">
        <PromptInput onSubmit={() => submit()}>
          <PromptInputTextarea
            ref={textareaRef as any}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={generationId ? "Tell me what to change…" : "Generate a schedule first"}
            disabled={!generationId || !hydrated}
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit
              status={status}
              disabled={isLoading ? false : !canSend}
              onStop={() => stop()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </aside>
  );
}
