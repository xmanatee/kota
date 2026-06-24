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
  const metadata = formatRecallMetadata(hit);
  switch (hit.source) {
    case "knowledge":
      return appendMetadata(hit.title, metadata);
    case "memory":
      return appendMetadata(hit.preview, metadata);
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

function formatRecallMetadata(hit: RecallHit): string {
  if (hit.source !== "knowledge" && hit.source !== "memory") return "";
  const pieces: string[] = [];
  if (hit.provenance) {
    pieces.push(
      `${formatProvenanceLocator(hit.provenance)} observed ${hit.provenance.observedAt.slice(0, 10)}`,
    );
  }
  if (hit.freshness) {
    const replacement = hit.freshness.replacementId
      ? ` -> ${hit.freshness.replacementId}`
      : "";
    const changed = hit.freshness.changedAt
      ? ` ${hit.freshness.changedAt.slice(0, 10)}`
      : "";
    pieces.push(`${hit.freshness.status}${replacement}${changed}`);
  }
  return pieces.join("; ");
}

function formatProvenanceLocator(
  provenance: NonNullable<Extract<RecallHit, { source: "knowledge" }>["provenance"]>,
): string {
  switch (provenance.sourceKind) {
    case "run":
    case "session":
      return `${provenance.sourceKind}:${provenance.sourceId ?? "unknown"}`;
    case "file":
      return `file:${provenance.sourcePath ?? "unknown"}`;
    case "url":
      return `url:${provenance.sourceUrl ?? "unknown"}`;
    case "tool":
      return `tool:${provenance.sourceTool ?? provenance.sourceId ?? "unknown"}`;
    case "manual":
      return "manual";
  }
}

function appendMetadata(label: string, metadata: string): string {
  return metadata ? `${label} | ${metadata}` : label;
}

export function formatRecallScore(score: number): string {
  return score.toFixed(SCORE_PRECISION);
}
