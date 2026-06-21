import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrainCircuit, X as XIcon, AlertCircle, Check, Loader2, MoveRight, ArrowLeftRight, Trash2, Plus, Wrench } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { PromptInput, PromptInputTextarea, PromptInputSubmit, PromptInputFooter } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";

const QUICK_PROMPTS = [
  "Move 3rd grade music to Tuesday morning",
  "Give every specialist a 30-minute prep on Friday",
  "Even out specialist workload across days",
  "Swap PE and Art for 5th grade on Monday",
];

interface ScheduleChatPanelProps {
  generationId: string | null;
  onClose: () => void;
  onScheduleChanged: () => void;
  /** Called after Apply with the ids of blocks that changed, so the page can
   *  highlight them in the grid. */
  onApplied?: (changedBlockIds: string[]) => void;
}

/** Human description for a proposed edit op. Falls back for ops proposed by
 *  an older server build without labels. */
function opLabel(op: any): string {
  if (op?.label) return op.label;
  switch (op?.kind) {
    case "move": return `Move block → ${op.day_of_week} ${String(op.start_time).slice(0, 5)}`;
    case "swap": return "Swap two blocks";
    case "delete": return "Remove a block";
    case "insert": return `Add ${op.subject ?? "block"} → ${op.day_of_week} ${String(op.start_time).slice(0, 5)}`;
    default: return "Schedule change";
  }
}

function OpIcon({ kind }: { kind?: string }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (kind === "move") return <MoveRight className={cls} />;
  if (kind === "swap") return <ArrowLeftRight className={cls} />;
  if (kind === "delete") return <Trash2 className={cls} />;
  if (kind === "insert") return <Plus className={cls} />;
  return <Wrench className={cls} />;
}

/** Inline card for a proposed (or rejected) tool action — replaces the raw
 *  JSON tool dump with a plain-language description. */
function ProposalCard({ output }: { output: any }) {
  if (output?.status === "proposed" && output.op) {
    return (
      <div className="my-1.5 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs">
        <span className="mt-0.5 text-amber-700 dark:text-amber-400"><OpIcon kind={output.op.kind} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{opLabel(output.op)}</p>
          <p className="text-[10px] text-muted-foreground">Proposed — review and apply below.</p>
        </div>
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

export default function ScheduleChatPanel({ generationId, onClose, onScheduleChanged, onApplied }: ScheduleChatPanelProps) {
  const [hydratedMessages, setHydratedMessages] = useState<UIMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const tokenRef = useRef<string | null>(null);
  // Proposed edits the user has already applied or discarded (by toolCallId),
  // so they drop out of the pending Apply bar.
  const [resolvedCallIds, setResolvedCallIds] = useState<Set<string>>(new Set());
  const [rejectedCallIds, setRejectedCallIds] = useState<Set<string>>(new Set());
  const [skippedByCallId, setSkippedByCallId] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);

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
        console.log("[chat] fetch →", typeof input === "string" ? input : (input as Request).url);
        try {
          const resp = await fetch(input as any, init);
          console.log("[chat] fetch ←", resp.status, resp.statusText);
          if (!resp.ok) {
            // Surface server error body before AI SDK's generic "Failed to fetch".
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
      // then — treat them all as resolved so they don't reappear in the Apply
      // bar. Only NEW proposals from this session are actionable.
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

  // Pending proposals = tool outputs the AI returned with status "proposed"
  // that the user hasn't yet applied or discarded. These are the edits the
  // Apply bar will commit (re-validated server-side) on confirmation.
  const pendingProposals = useMemo(() => {
    const out: { toolCallId: string; op: unknown }[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      m.parts.forEach((part: any, idx) => {
        if (!part?.type?.startsWith?.("tool-")) return;
        const output = part.output;
        if (!output || output.status !== "proposed" || !output.op) return;
        const callId = part.toolCallId ?? `${m.id}-${idx}`;
        if (resolvedCallIds.has(callId)) return;
        out.push({ toolCallId: callId, op: output.op });
      });
    }
    return out;
  }, [messages, resolvedCallIds]);

  function markResolved(callIds: string[]) {
    setResolvedCallIds((prev) => {
      const next = new Set(prev);
      callIds.forEach((id) => next.add(id));
      return next;
    });
  }

  // Proposals the user hasn't rejected — only these get applied.
  const acceptedProposals = useMemo(
    () => pendingProposals.filter((p) => !rejectedCallIds.has(p.toolCallId)),
    [pendingProposals, rejectedCallIds],
  );

  function toggleReject(callId: string) {
    setRejectedCallIds((prev) => {
      const next = new Set(prev);
      next.has(callId) ? next.delete(callId) : next.add(callId);
      return next;
    });
  }

  async function applyChanges() {
    if (!generationId || applying || acceptedProposals.length === 0) return;
    setApplying(true);
    setSkippedByCallId({});
    const ops = acceptedProposals.map((p) => p.op);
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

      // Map each skipped reason back to the proposal it belongs to (by block id)
      // so the user sees exactly WHICH change failed and WHY — and keep those
      // rows visible (annotated) instead of silently dropping them.
      const skipped: string[] = Array.isArray(data.skipped) ? data.skipped : [];
      const skipMap: Record<string, string> = {};
      const appliedCallIds: string[] = [];
      for (const p of acceptedProposals) {
        const op: any = p.op;
        const ids = [op.block_id, op.a_id, op.b_id].filter(Boolean) as string[];
        const reason = ids.length ? skipped.find((s) => ids.some((id) => s.includes(id))) : undefined;
        if (reason) skipMap[p.toolCallId] = reason.replace(/^[a-z]+\s+[0-9a-f-]+:\s*/i, "");
        else appliedCallIds.push(p.toolCallId);
      }
      markResolved(appliedCallIds);   // applied → leave the review list
      setSkippedByCallId(skipMap);    // failed → stay, with the reason shown

      onScheduleChanged();
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
    markResolved(pendingProposals.map((p) => p.toolCallId));
    setRejectedCallIds(new Set());
    setSkippedByCallId({});
  }

  async function submit() {
    const text = input.trim();
    console.log("[chat] submit attempt", { text, generationId, isLoading, hydrated });
    if (!text) return;
    if (!generationId) {
      toast({ title: "No schedule selected", description: "Generate a schedule first.", variant: "destructive" });
      return;
    }
    if (isLoading) {
      toast({ title: "Already sending", description: "Wait for the current response to finish." });
      return;
    }
    // Starting a new turn re-plans from the live DB, so un-applied proposals
    // from a previous turn become stale. Don't drop them silently — confirm
    // first so the user never loses pending work by accident.
    if (pendingProposals.length) {
      const proceed = window.confirm(
        `You have ${pendingProposals.length} unapplied change${pendingProposals.length === 1 ? "" : "s"}. Sending a new message will discard ${pendingProposals.length === 1 ? "it" : "them"}. Continue?`,
      );
      if (!proceed) return;
      discardChanges();
    }
    setInput("");
    try {
      console.log("[chat] sendMessage", text);
      await sendMessage({ text });
      console.log("[chat] sendMessage resolved");
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
                ? "Describe changes — I'll move, swap, or add blocks."
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
              title="What should I change?"
              description="Try one of the suggestions below, or type your own."
            />
          ) : (
            messages.map((m) => {
              const parts = (m.parts ?? []) as any[];
              const hasText = parts.some((p) => p.type === "text" && p.text?.trim());
              const proposedCount = parts.filter((p) => p.type?.startsWith?.("tool-") && p.output?.status === "proposed").length;
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
                    {/* Assistant turns that only made tool proposals (no prose)
                        still get a clear, visible acknowledgement in the chat. */}
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

      {pendingProposals.length > 0 && !isLoading && (
        <div className="border-t border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 text-xs">
              <p className="font-semibold text-foreground">Review changes — not saved yet</p>
              <p className="text-[10px] text-muted-foreground">
                {acceptedProposals.length} of {pendingProposals.length} selected. Uncheck any you don't want.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={discardChanges} disabled={applying}>
              Discard all
            </Button>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={applyChanges} disabled={applying || acceptedProposals.length === 0}>
              {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {applying ? "Applying…" : `Apply ${acceptedProposals.length || ""}`.trim()}
            </Button>
          </div>
          <ul className="max-h-40 overflow-y-auto space-y-1">
            {pendingProposals.map((p) => {
              const rejected = rejectedCallIds.has(p.toolCallId);
              const skipReason = skippedByCallId[p.toolCallId];
              return (
                <li key={p.toolCallId} className="rounded border border-border/60 bg-background/60 px-2 py-1.5">
                  <label className="flex items-start gap-2 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                      checked={!rejected}
                      onChange={() => toggleReject(p.toolCallId)}
                      disabled={applying}
                    />
                    <span className="mt-0.5 text-amber-700 dark:text-amber-400"><OpIcon kind={(p.op as any)?.kind} /></span>
                    <span className={`min-w-0 flex-1 ${rejected ? "line-through opacity-50" : "text-foreground"}`}>
                      {opLabel(p.op)}
                    </span>
                  </label>
                  {skipReason && (
                    <p className="mt-1 pl-6 text-[10px] font-medium text-destructive">Couldn't apply: {skipReason}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
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
