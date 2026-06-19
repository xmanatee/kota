import type { AnswerCitation, AnswerResult, RecallHit } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import {
  RECALL_SOURCE_BADGE_VARIANT,
  describeRecallHit,
  formatRecallScore,
} from "@/lib/recall-render";

export const ANSWER_FAILURE_MESSAGE: Record<
  Extract<AnswerResult, { ok: false }>["reason"],
  string
> = {
  no_hits: "No matching sources for this question.",
  semantic_unavailable:
    "Answer unavailable — no recall contributors registered.",
  synthesis_failed: "Could not compose a cited answer for this question.",
};

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
    case "answer":
      match = hits.find((h) => h.source === "answer" && h.id === citation.id);
      break;
  }
  if (!match) {
    throw new Error(
      `AnswerResultView: citation ${citation.source}:${citation.id} has no matching hit`,
    );
  }
  return match;
}

export function AnswerResultView({ result }: { result: AnswerResult }) {
  if (!result.ok) {
    return (
      <div className="text-xs text-muted-foreground">
        {ANSWER_FAILURE_MESSAGE[result.reason]}
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
        variant={RECALL_SOURCE_BADGE_VARIANT[citation.source]}
        className="h-5 shrink-0 text-[10px]"
      >
        {citation.source}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {citation.id}
        </div>
        <div className="truncate">{describeRecallHit(hit)}</div>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatRecallScore(hit.score)}
      </span>
    </div>
  );
}
