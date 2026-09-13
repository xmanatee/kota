import type { EvidenceJsonValue } from "#core/evidence/policy.js";
import type { BlockedEvidence } from "./evidence.js";

/** Short identities require an explicit code citation, not a six-letter prose word. */
export function evidenceReferences(task: { id: string; body: string }): string[] {
  const tokens = task.body.match(/[A-Za-z0-9.][A-Za-z0-9._/-]*/g) ?? [];
  const paths = tokens.filter((token) => /^\.kota\/(?:eval-runs|runs)\/[^/]+/.test(token) &&
    !token.split("/").some((part) => part === "." || part === ".."));
  const runIds = paths.flatMap((path) => path.startsWith(".kota/runs/") ? [path.split("/")[2]!] : []);
  const shortIds = [...task.body.matchAll(/`([a-z0-9]{6})`/g)].map((match) => match[1]!);
  return [...new Set([...paths, ...runIds, ...shortIds,
    ...tokens.filter((token) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/.test(token))])];
}

// Observation and attempt bookkeeping cannot authorize another attempt at the
// same outcome. Keep source, isolation and result facts in the fingerprint;
// the full capture, including execution chronology, stays reviewable.
const ATTEMPT_METADATA = new Set([
  "capturedAt", "observedAt", "exportedAt", "generatedAt", "startedAt",
  "finishedAt", "completedAt", "createdAt", "updatedAt", "timestamp",
  "durationMs", "elapsedMs", "runId", "attemptId", "executionId",
]);

// Eval attempt locations, scoped so source and isolation paths stay substantive.
const EXECUTION_LOCATIONS = new Set([
  "runArtifactPath", "fixture.workingDir", "execution.runArtifactPath",
  "rounds.runArtifactPath", "executionEvidence.artifactDir",
]);

export function evidenceOutcome(value: EvidenceJsonValue): EvidenceJsonValue {
  return normalizeOutcome(value, "");
}

function normalizeOutcome(value: EvidenceJsonValue, location: string): EvidenceJsonValue {
  if (Array.isArray(value)) return value.map((child) => normalizeOutcome(child, location));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !ATTEMPT_METADATA.has(key))
      .filter(([key]) => !EXECUTION_LOCATIONS.has(location ? `${location}.${key}` : key))
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([key, child]) => child === undefined ? [] : [[key,
        normalizeOutcome(child, location ? `${location}.${key}` : key)]]));
  }
  return value;
}

/** Broad discovery needs an attributable task or task-cited run/export link. */
export function relevantBlockedEvidence(
  collection: BlockedEvidence,
  task: { id: string; body: string; hint: string },
): BlockedEvidence {
  if (![".kota/runs", ".kota/eval-runs"].includes(task.hint.replace(/\/+$/, ""))) return collection;
  const tokens = new Set(evidenceReferences(task));
  const cohort = (path: string) => path.split("/").slice(0, 3).join("/");
  const linked = new Set<string>();
  for (const artifact of collection.artifacts) {
    const runId = artifact.path.split("/")[2] ?? "";
    // Runtime run IDs carry a short identity used in ordinary task citations.
    const shortId = runId.split("-").at(-1) ?? "";
    const content = JSON.stringify(artifact.content);
    if (tokens.has(artifact.path) || tokens.has(cohort(artifact.path)) || tokens.has(runId) ||
      (shortId.length >= 6 && tokens.has(shortId)) || content.includes(JSON.stringify(task.id)) ||
      content.includes(JSON.stringify(`data/tasks/${task.id}.md`))) linked.add(cohort(artifact.path));
  }
  const artifacts = collection.artifacts.filter((artifact) => linked.has(cohort(artifact.path)));
  // Collection already selects scoped cohorts. Keep diagnostics even when all
  // files in a selected cohort are missing or unreadable and cannot link it.
  const unavailable = [...collection.unavailable];
  if (artifacts.length === 0) unavailable.push("No task-linked scoped evidence observed; retain task or cited run provenance in an authorized export");
  return { artifacts, unavailable };
}

/** Recovery consumes execution/capability facts, not reports about a task.
 * Unlike review discovery, one task mention cannot authorize a whole cohort.
 * Paths locate evidence; they are not evidence identity. Copies collapse to the
 * same semantic value while execution provenance remains part of that value.
 */
export function recoveryEvidenceOutcomes(
  collection: BlockedEvidence,
  task: { id: string; body: string },
): string[] {
  const tokens = new Set(evidenceReferences(task));
  const outcomes = new Set<string>();
  for (const artifact of collection.artifacts) {
    const runId = artifact.path.split("/")[2] ?? "";
    const shortId = runId.split("-").at(-1) ?? "";
    const content = artifact.content;
    const cited = tokens.has(artifact.path) || tokens.has(artifact.path.split("/").slice(0, 3).join("/")) ||
      tokens.has(runId) || (shortId.length >= 6 && tokens.has(shortId));
    const attributed = content.taskId === task.id || content.taskPath === `data/tasks/${task.id}.md`;
    if (!cited && !attributed) continue;
    // Existing scoped exports expose capabilities, probe results, and eval
    // execution outcomes. Workflow metadata and narrative reviews do not.
    const capability = typeof content.capability === "string" && typeof content.status === "string";
    const execution = content.execution !== undefined &&
      (typeof content.exitCode === "number" || Array.isArray(content.predicateResults));
    const scopedResult = content.source !== undefined &&
      (content.results !== undefined || content.outcome !== undefined);
    if (!capability && !execution && !scopedResult) continue;
    outcomes.add(JSON.stringify(evidenceOutcome(content)));
  }
  return [...outcomes].sort();
}
