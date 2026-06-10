import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrainCircuit, X as XIcon, AlertCircle, Check, Loader2 } from "lucide-react";
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
}

export default function ScheduleChatPanel({ generationId, onClose, onScheduleChanged }: ScheduleChatPanelProps) {
  const [hydratedMessages, setHydratedMessages] = useState<UIMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const tokenRef = useRef<string | null>(null);
  // Proposed edits the user has already applied or discarded (by toolCallId),
  // so they drop out of the pending Apply bar.
  const [resolvedCallIds, setResolvedCallIds] = useState<Set<string>>(new Set());
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
          "Content-Type": "application/json",
        };
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

  async function applyChanges() {
    if (!generationId || applying || pendingProposals.length === 0) return;
    setApplying(true);
    const callIds = pendingProposals.map((p) => p.toolCallId);
    const ops = pendingProposals.map((p) => p.op);
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
      markResolved(callIds);
      onScheduleChanged();
      const skipped: string[] = Array.isArray(data.skipped) ? data.skipped : [];
      toast({
        title: skipped.length
          ? `Applied ${data.applied}, skipped ${skipped.length}`
          : `Applied ${data.applied} change${data.applied === 1 ? "" : "s"}`,
        description: skipped.length ? skipped.slice(0, 3).join("; ") : "The schedule has been updated.",
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
  }

  async function submit() {
    const text = input.trim();
    if (!text || isLoading || !generationId) return;
    // Starting a new turn: the server re-plans from the live DB, so any
    // un-applied proposals from a previous turn are stale — drop them.
    if (pendingProposals.length) discardChanges();
    setInput("");
    try {
      await sendMessage({ text });
    } catch (err: any) {
      // Surface as inline error; useChat's error state also catches transport errors.
      console.error("[chat] send failed", err);
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
            messages.map((m) => (
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
                </MessageContent>
              </Message>
            ))
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
        <div className="flex items-center gap-3 border-t border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2.5">
          <div className="flex-1 text-xs">
            <p className="font-semibold text-foreground">
              {pendingProposals.length} proposed change{pendingProposals.length === 1 ? "" : "s"} — not saved yet
            </p>
            <p className="text-muted-foreground">Review the steps above, then apply or discard.</p>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={discardChanges} disabled={applying}>
            Discard
          </Button>
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={applyChanges} disabled={applying}>
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {applying ? "Applying…" : "Apply"}
          </Button>
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
              status={isLoading ? "streaming" : "ready"}
              disabled={isLoading ? false : !canSend}
              onClick={isLoading ? () => stop() : undefined}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </aside>
  );
}
