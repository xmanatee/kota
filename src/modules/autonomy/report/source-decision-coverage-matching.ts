import type { ExternalPatternVerdict } from "#modules/autonomy/external-pattern-decisions.js";
import { EXTERNAL_PATTERN_DECISIONS } from "#modules/autonomy/external-pattern-decisions.js";
import type { WatchlistEntry } from "#modules/autonomy/workflows/explorer/watchlist.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  SourceDecisionDisposition,
  SourceDecisionLocalMarker,
  SourceDecisionTaskRef,
} from "./source-decision-coverage-types.js";

const TASK_ID_RE = /\btask-[a-z0-9-]+/g;
const NOOP_DECISION_RE =
  /\b(?:no duplicate task|no duplicate|no new task|no new kota task|no new primitive|no new kota primitive|no-op|do not import|do not add)\b/i;
const WATCH_DECISION_RE = /\b(?:monitor|watch|snapshot and distill|revisit)\b/i;
const STOP_TOKENS = new Set([
  "about",
  "agent",
  "agents",
  "architecture",
  "benchmark",
  "benchmarks",
  "blog",
  "docs",
  "framework",
  "github",
  "guide",
  "guides",
  "latest",
  "paper",
  "reference",
  "research",
  "sdk",
  "source",
  "workflow",
  "workflows",
  "www",
]);

export function defaultLocalDecisionMarkers(): SourceDecisionLocalMarker[] {
  return EXTERNAL_PATTERN_DECISIONS.map((decision) => ({
    sourceRefs: [decision.source, decision.pattern],
    disposition: dispositionFromExternalVerdict(decision.verdict),
    summary:
      `${decision.pattern}: ${decision.verdict} against ` +
      `${decision.kotaPrimitives.join(", ")}.`,
    refs: [
      "src/modules/autonomy/AGENTS.md#external-pattern-decisions",
      "src/modules/autonomy/external-pattern-decisions.ts",
    ],
    remainingGap:
      decision.verdict === "read" || decision.verdict === "defer"
        ? decision.revisitWhen
        : null,
  }));
}

export function findMappedTasks(
  entry: WatchlistEntry,
  sourceRefs: readonly string[],
  tasks: readonly RepoTaskFullRecord[],
  taskById: ReadonlyMap<string, RepoTaskFullRecord>,
): SourceDecisionTaskRef[] {
  const mapped = new Map<string, SourceDecisionTaskRef>();
  for (const taskId of taskIdsFromEntry(entry)) {
    const task = taskById.get(taskId);
    if (task !== undefined) mapped.set(task.id, taskRef(task));
  }
  for (const task of tasks) {
    if (taskMentionsAnySource(task, sourceRefs)) mapped.set(task.id, taskRef(task));
  }
  return [...mapped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function markerMatchesEntry(
  marker: SourceDecisionLocalMarker,
  entry: WatchlistEntry,
): boolean {
  const sourceRefs = sourceRefsForEntry(entry).map(normalizeText);
  const exactRefs = marker.sourceRefs.map(normalizeText);
  if (
    exactRefs.some((markerRef) =>
      sourceRefs.some(
        (sourceRef) =>
          markerRef === sourceRef ||
          markerRef.includes(sourceRef) ||
          sourceRef.includes(markerRef),
      ),
    )
  ) {
    return true;
  }

  const markerText = normalizeCompact(
    [...marker.sourceRefs, marker.summary].join("\n"),
  );
  return sourceTokens(entry).some((token) => markerText.includes(token));
}

export function sourceRefsForEntry(entry: WatchlistEntry): string[] {
  return [entry.url, ...(entry.canonicalizedFrom ?? [])];
}

export function sourceTextForEntry(entry: WatchlistEntry): string {
  return [
    entry.url,
    ...(entry.canonicalizedFrom ?? []),
    entry.notes ?? "",
    entry.snapshot?.summary ?? "",
  ].join("\n");
}

export function hasLocalNoopDecision(entry: WatchlistEntry): boolean {
  return NOOP_DECISION_RE.test(sourceTextForEntry(entry));
}

export function hasLocalWatchDecision(entry: WatchlistEntry): boolean {
  return WATCH_DECISION_RE.test(sourceTextForEntry(entry));
}

export function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function taskIdsFromEntry(entry: WatchlistEntry): string[] {
  const matches = sourceTextForEntry(entry).match(TASK_ID_RE) ?? [];
  return dedupeStrings(matches.map((match) => match.replace(/[.,;:)]+$/, "")));
}

function taskMentionsAnySource(
  task: RepoTaskFullRecord,
  sourceRefs: readonly string[],
): boolean {
  const text = normalizeText([task.title, task.summary, task.body].join("\n"));
  return sourceRefs.some((ref) => {
    const normalizedRef = normalizeText(ref);
    return normalizedRef.length > 0 && text.includes(normalizedRef);
  });
}

function sourceTokens(entry: WatchlistEntry): string[] {
  const tokens = new Set<string>();
  for (const ref of sourceRefsForEntry(entry)) {
    for (const raw of urlTokenCandidates(ref)) {
      const token = normalizeCompact(raw);
      if (token.length >= 5 && !STOP_TOKENS.has(token)) tokens.add(token);
    }
  }
  return [...tokens];
}

function urlTokenCandidates(ref: string): string[] {
  try {
    const url = new URL(ref);
    const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
    const candidates = pathParts.length > 0 ? [...pathParts] : [url.hostname];
    if (pathParts.length >= 2) {
      candidates.push(`${pathParts.at(-2) ?? ""}/${pathParts.at(-1) ?? ""}`);
    }
    return candidates;
  } catch {
    return ref.split(/[/:#?&.\s_-]+/).filter((part) => part.length > 0);
  }
}

function dispositionFromExternalVerdict(
  verdict: ExternalPatternVerdict,
): SourceDecisionDisposition {
  switch (verdict) {
    case "adopt":
      return "adopt";
    case "reject":
      return "reject";
    case "read":
    case "defer":
      return "watch";
  }
}

function taskRef(task: RepoTaskFullRecord): SourceDecisionTaskRef {
  return {
    id: task.id,
    title: task.title,
    state: task.state,
  };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCompact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
