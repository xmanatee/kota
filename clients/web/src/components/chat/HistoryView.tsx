import { historyDetailQuery } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { renderMarkdown } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

export function HistoryView({
  id,
  onBack,
}: { id: string; onBack: () => void }) {
  const { data, isLoading, isError } = useQuery(historyDetailQuery(id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          \u2190 Back to chat
        </Button>
        <span className="text-xs text-muted-foreground">Read-only view</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && (
          <div className="text-sm text-muted-foreground">Loading...</div>
        )}
        {isError && (
          <div className="text-sm text-destructive">
            Could not load conversation
          </div>
        )}
        {data?.messages?.map((msg, i) => {
          if (msg.role !== "user" && msg.role !== "assistant") return null;
          const text =
            typeof msg.content === "string"
              ? msg.content
              : (msg.content ?? [])
                  .filter((b) => b.type === "text")
                  .map((b) => b.text ?? "")
                  .join("\n");
          if (!text) return null;
          return (
            <div
              key={i}
              className={`mb-3 ${msg.role === "user" ? "text-right" : ""}`}
            >
              <div
                className={`inline-block max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
                  />
                ) : (
                  <span className="whitespace-pre-wrap">{text}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
