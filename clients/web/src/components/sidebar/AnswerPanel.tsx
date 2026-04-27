import { api } from "@/api/client";
import type {
  AnswerCitation,
  AnswerResult,
  RecallHit,
  RecallSource,
} from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

const SOURCE_BADGE_VARIANT: Record<
  RecallSource,
  "default" | "secondary" | "success" | "warning" | "running"
> = {
  knowledge: "default",
  memory: "secondary",
  history: "running",
  tasks: "warning",
};

const FAILURE_MESSAGE: Record<
  Extract<AnswerResult, { ok: false }>["reason"],
  string
> = {
  no_hits: "No matching sources for this question.",
  semantic_unavailable:
    "Answer unavailable — no recall contributors registered.",
  synthesis_failed: "Could not compose a cited answer for this question.",
};

function describeHit(hit: RecallHit): string {
  switch (hit.source) {
    case "knowledge":
      return hit.title;
    case "memory":
      return hit.preview;
    case "history":
      return hit.title;
    case "tasks":
      return `[${hit.state}/${hit.priority}] ${hit.title}`;
  }
}

function formatScore(score: number): string {
  return score.toFixed(3);
}

function findHit(hits: RecallHit[], citation: AnswerCitation): RecallHit {
  let match: RecallHit | undefined;
  switch (citation.source) {
    case "knowledge":
      match = hits.find(
        (h) => h.source === "knowledge" && h.id === citation.id,
      );
      break;
    case "memory":
      match = hits.find((h) => h.source === "memory" && h.id === citation.id);
      break;
    case "history":
      match = hits.find((h) => h.source === "history" && h.id === citation.id);
      break;
    case "tasks":
      match = hits.find((h) => h.source === "tasks" && h.id === citation.id);
      break;
  }
  if (!match) {
    throw new Error(
      `AnswerPanel: citation ${citation.source}:${citation.id} has no matching hit`,
    );
  }
  return match;
}

export function AnswerPanel() {
  const [draft, setDraft] = useState("");
  const answer = useMutation<AnswerResult, Error, string>({
    mutationFn: (query: string) => api.answer(query),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === "") return;
    answer.mutate(trimmed);
  }

  return (
    <div className="space-y-1.5">
      <form className="flex gap-1.5" onSubmit={onSubmit}>
        <Input
          className="h-7 text-xs"
          placeholder="Ask the second brain..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={draft.trim() === "" || answer.isPending}
        >
          {answer.isPending ? "..." : "Answer"}
        </Button>
      </form>

      {answer.isError && (
        <div className="text-xs text-destructive">{answer.error.message}</div>
      )}

      {answer.data && <AnswerResultView result={answer.data} />}
    </div>
  );
}

function AnswerResultView({ result }: { result: AnswerResult }) {
  if (!result.ok) {
    return (
      <div className="text-xs text-muted-foreground">
        {FAILURE_MESSAGE[result.reason]}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap text-xs leading-snug">
        {result.answer}
      </div>
      {result.citations.length > 0 && (
        <div className="space-y-1 border-t border-border pt-1.5">
          {result.citations.map((citation, index) => {
            const hit = findHit(result.hits, citation);
            return (
              <CitationRow
                key={`${citation.source}:${citation.id}:${index}`}
                citation={citation}
                hit={hit}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function CitationRow({
  citation,
  hit,
}: {
  citation: AnswerCitation;
  hit: RecallHit;
}) {
  return (
    <div className="flex items-start gap-1.5 text-xs">
      <Badge
        variant={SOURCE_BADGE_VARIANT[citation.source]}
        className="h-5 shrink-0 text-[10px]"
      >
        {citation.source}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {citation.id}
        </div>
        <div className="truncate">{describeHit(hit)}</div>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatScore(hit.score)}
      </span>
    </div>
  );
}
