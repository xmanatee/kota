import { api } from "@/api/client";
import { queryKeys, sessionsQuery, slashCommandsQuery } from "@/api/queries";
import type { AutonomyMode, SlashCommand } from "@/api/types";
import { AutonomyModeSelect } from "@/components/autonomy/AutonomyModeControl";
import { SlashCommandPalette } from "@/components/chat/SlashCommandPalette";
import { VoiceControls } from "@/components/chat/VoiceControls";
import { Button } from "@/components/ui/button";
import { renderMarkdown } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant" | "error" | "system";
  content: string;
};

function paletteQuery(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const rest = input.slice(1);
  if (rest.includes(" ") || rest.includes("\n")) return null;
  return rest;
}

export function ChatArea({
  sessionId,
  onSessionCreated,
}: {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: sessionsData } = useQuery(sessionsQuery);
  const activeSession = sessionId
    ? (sessionsData?.sessions.find((s) => s.id === sessionId) ?? null)
    : null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [pendingMode, setPendingMode] = useState<AutonomyMode>("supervised");
  const [voiceError, setVoiceError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lastAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg && msg.role === "assistant" && msg.content.trim()) {
        return msg.content;
      }
    }
    return null;
  }, [messages]);

  const { data: commandsData } = useQuery(slashCommandsQuery);
  const commands = commandsData?.commands ?? [];
  const rawPaletteQuery = paletteQuery(input);
  const showPalette = paletteOpen && rawPaletteQuery !== null;

  const setMode = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: AutonomyMode }) =>
      api.setSessionAutonomyMode(id, mode),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });

  const scrollToBottom = useCallback(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, []);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const invokeCommand = useCallback(
    async (cmd: SlashCommand) => {
      setPaletteOpen(false);
      if (cmd.source === "skill") {
        try {
          const result = await api.invokeSlashCommand(cmd.name);
          if (result.kind === "skill") {
            setInput(result.prompt);
            requestAnimationFrame(() => {
              autoResize();
              textareaRef.current?.focus();
            });
          }
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            {
              role: "error",
              content: `Failed to load ${cmd.label}: ${(err as Error).message}`,
            },
          ]);
        }
        return;
      }
      setInput("");
      try {
        const result = await api.invokeSlashCommand(cmd.name);
        if (result.kind === "workflow") {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `Queued workflow ${result.queued}${result.runId ? ` (run ${result.runId})` : ""}.`,
            },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "error",
            content: `Failed to invoke ${cmd.label}: ${(err as Error).message}`,
          },
        ]);
      }
      textareaRef.current?.focus();
    },
    [autoResize],
  );

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");

    setMessages((prev) => [...prev, { role: "user", content: text }]);

    let sid = sessionId;
    if (!sid) {
      try {
        const res = await api.createSession(pendingMode);
        sid = res.session_id;
        onSessionCreated(sid);
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "error", content: "Failed to create session" },
        ]);
        setSending(false);
        return;
      }
    }

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    let fullText = "";

    try {
      const res = await api.chat(text, sid);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "error",
            content: (err as { error: string }).error,
          };
          return next;
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as {
                type: string;
                content?: string;
                message?: string;
              };
              if (data.type === "text" && data.content) {
                fullText += data.content;
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = {
                    role: "assistant",
                    content: fullText,
                  };
                  return next;
                });
                scrollToBottom();
              } else if (data.type === "error") {
                fullText += `\n[Error: ${data.message ?? "unknown"}]`;
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = {
                    role: "assistant",
                    content: fullText,
                  };
                  return next;
                });
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }

      if (!fullText) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: "No response" };
          return next;
        });
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "error",
          content: `Connection error: ${(err as Error).message}`,
        };
        return next;
      });
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showPalette) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="text-muted-foreground">Autonomy:</span>
        {activeSession ? (
          <AutonomyModeSelect
            value={activeSession.autonomyMode}
            disabled={setMode.isPending}
            onChange={(mode) => setMode.mutate({ id: activeSession.id, mode })}
          />
        ) : (
          <AutonomyModeSelect value={pendingMode} onChange={setPendingMode} />
        )}
        {!activeSession && (
          <span className="text-muted-foreground">(new session)</span>
        )}
      </div>
      <div ref={messagesRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <h2 className="text-2xl font-bold">KOTA</h2>
              <p className="mt-2 text-muted-foreground">
                General-purpose AI assistant.
                <br />
                Ask anything \u2014 research, code, analysis, writing, planning.
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mb-3 ${msg.role === "user" ? "text-right" : ""}`}
          >
            <div
              className={`inline-block max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : msg.role === "error"
                    ? "bg-destructive/10 text-destructive"
                    : msg.role === "system"
                      ? "bg-accent/20 text-muted-foreground italic"
                      : "bg-muted"
              }`}
            >
              {msg.role === "assistant" ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{
                    __html:
                      renderMarkdown(msg.content) ||
                      '<span class="text-muted-foreground">Thinking...</span>',
                  }}
                />
              ) : (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        {voiceError ? (
          <div
            role="alert"
            data-testid="voice-error"
            className="mb-2 flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <span>
              <span className="font-mono">[{voiceError.code}]</span>{" "}
              {voiceError.message}
            </span>
            <button
              type="button"
              className="text-destructive/80 hover:text-destructive"
              onClick={() => setVoiceError(null)}
              aria-label="Dismiss voice error"
            >
              ×
            </button>
          </div>
        ) : null}
        <div className="relative flex gap-2">
          {showPalette ? (
            <SlashCommandPalette
              commands={commands}
              query={rawPaletteQuery ?? ""}
              onPick={(cmd) => void invokeCommand(cmd)}
              onDismiss={() => setPaletteOpen(false)}
            />
          ) : null}
          <VoiceControls
            speakableText={lastAssistantText}
            onTranscript={(text) => {
              setVoiceError(null);
              setInput((prev) =>
                prev.trim() ? `${prev.trim()} ${text}` : text,
              );
              requestAnimationFrame(() => {
                autoResize();
                textareaRef.current?.focus();
              });
            }}
            onError={setVoiceError}
          />
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Message KOTA..."
            rows={1}
            value={input}
            onChange={(e) => {
              const next = e.target.value;
              setInput(next);
              if (next.startsWith("/")) setPaletteOpen(true);
              autoResize();
            }}
            onKeyDown={handleKeyDown}
          />
          <Button
            onClick={() => void sendMessage()}
            disabled={sending || !input.trim()}
          >
            \u2192
          </Button>
        </div>
      </div>
    </div>
  );
}
