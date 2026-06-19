import type { RecallHit, RecallSource } from "@/api/types";

const SCORE_PRECISION = 3;

export const RECALL_SOURCE_BADGE_VARIANT: Record<
  RecallSource,
  "default" | "secondary" | "success" | "warning" | "running"
> = {
  knowledge: "default",
  memory: "secondary",
  history: "running",
  tasks: "warning",
  answer: "success",
};

export function describeRecallHit(hit: RecallHit): string {
  switch (hit.source) {
    case "knowledge":
      return hit.title;
    case "memory":
      return hit.preview;
    case "history":
      return hit.title;
    case "tasks":
      return `[${hit.state}/${hit.priority}] ${hit.title}`;
    case "answer":
      return `[${
        hit.result.ok ? `ok(${hit.citationCount})` : hit.result.reason
      }] ${hit.query}`;
  }
}

export function formatRecallScore(score: number): string {
  return score.toFixed(SCORE_PRECISION);
}
