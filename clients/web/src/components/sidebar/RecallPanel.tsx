import { api } from "@/api/client";
import type { RecallResult } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RECALL_SOURCE_BADGE_VARIANT,
  describeRecallHit,
  formatRecallScore,
} from "@/lib/recall-render";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

export function RecallPanel() {
  const [draft, setDraft] = useState("");
  const recall = useMutation<RecallResult, Error, string>({
    mutationFn: (query: string) => api.recall(query),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === "") return;
    recall.mutate(trimmed);
  }

  return (
    <div className="space-y-1.5">
      <form className="flex gap-1.5" onSubmit={onSubmit}>
        <Input
          className="h-7 text-xs"
          placeholder="Recall across stores..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={draft.trim() === "" || recall.isPending}
        >
          {recall.isPending ? "..." : "Recall"}
        </Button>
      </form>

      {recall.isError && (
        <div className="text-xs text-destructive">{recall.error.message}</div>
      )}

      {recall.data && <RecallResultView result={recall.data} />}
    </div>
  );
}

function RecallResultView({ result }: { result: RecallResult }) {
  if (!result.ok) {
    return (
      <div className="text-xs text-muted-foreground">
        Recall unavailable — no contributors registered
      </div>
    );
  }
  if (result.hits.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No matching hits.</div>
    );
  }
  return (
    <div className="space-y-1">
      {result.hits.map((hit) => (
        <div
          key={`${hit.source}:${hit.id}`}
          className="flex items-start gap-1.5 text-xs"
        >
          <Badge
            variant={RECALL_SOURCE_BADGE_VARIANT[hit.source]}
            className="h-5 shrink-0 text-[10px]"
          >
            {hit.source}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="truncate">{describeRecallHit(hit)}</div>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {formatRecallScore(hit.score)}
          </span>
        </div>
      ))}
    </div>
  );
}
