import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrainCircuit, X as XIcon } from "lucide-react";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { PromptInput, PromptInputTextarea, PromptInputSubmit, PromptInputFooter } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { toast } from "@/hooks/use-toast";

const QUICK_PROMPTS = [
  "Move 3rd grade music to Tuesday morning",
  "Give every specialist a 30-minute prep on Friday",
  "Even out specialist workload across days",
  "Swap PE and Art for 5th grade on Monday",
];

interface ScheduleChatPanelProps {
  generationId: string;
  onClose: () => void;
  onScheduleChanged: () => void;
}

export default function ScheduleChatPanel({ generationId, onClose, onScheduleChanged }: ScheduleChatPanelProps) {
  const [hydratedMessages, setHydratedMessages] = useState<UIMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const tokenRef = useRef<string | null>(null);

  const transport = useMemo(() => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/schedule-chat`;
    return new DefaultChatTransport({
      api: url,
      // body merged into every request
      body: { generation_id: generationId },
      // refresh token each call so long-lived sessions don't 401
      headers: async () => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? tokenRef.current ?? "";
        tokenRef.current = token;
        return {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };
      },
    });
  }, [generationId]);

  // Hydrate persisted chat_history once.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("schedule_generations")
        .select("chat_history")
        .eq("id", generationId)
        .maybeSingle();
      if (!alive) return;
      const hist = Array.isArray((data as any)?.chat_history) ? ((data as any).chat_history as UIMessage[]) : [];
      setHydratedMessages(hist);
      setHydrated(true);
    })();
    return () => { alive = false; };
  }, [generationId]);

  const { messages, sendMessage, status, error, stop } = useChat({
    id: generationId,
    messages: hydratedMessages,
    transport,
    onError: (err) => {
      console.error("[chat] error", err);
      toast({ title: "Chat error", description: err.message, variant: "destructive" });
    },
    onFinish: () => {
      // After every assistant turn re-pull blocks (tools may have mutated them).
      onScheduleChanged();
    },
  });

  // Focus textarea on mount and after sends.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (hydrated) textareaRef.current?.focus();
  }, [hydrated, status]);

  const isLoading = status === "submitted" || status === "streaming";

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    try {
      await sendMessage({ text });
    } catch (err: any) {
      toast({ title: "Send failed", description: err?.message ?? "Unknown error", variant: "destructive" });
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
            <p className="text-xs text-muted-foreground">Describe changes — I'll move, swap, or add blocks.</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close AI editor">
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
            <Badge variant="destructive" className="mx-2">{error.message}</Badge>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {messages.length === 0 && (
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

      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        <PromptInput onSubmit={() => handleSubmit()}>
          <PromptInputTextarea
            ref={textareaRef as any}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell me what to change…"
            disabled={!hydrated}
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit
              status={isLoading ? "streaming" : "ready"}
              disabled={!hydrated || (!isLoading && !input.trim())}
              onClick={isLoading ? () => stop() : undefined}
            />
          </PromptInputFooter>
        </PromptInput>
      </form>
    </aside>
  );
}
