import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  FixtureCandidateAcceptedAction,
  FixtureCandidateRecord,
} from "./fixture-candidates-types.js";

function candidateTaskId(candidate: FixtureCandidateRecord): string {
  return `task-eval-candidate-${candidate.proposalFingerprint.split(":").at(-1) ?? "unknown"}`;
}

export function createCandidateTask(
  projectDir: string,
  candidate: FixtureCandidateRecord,
  nowIso: string,
): FixtureCandidateAcceptedAction | null {
  if (candidate.disposition !== "proposed") return null;
  const id = candidateTaskId(candidate);
  const state = "backlog" as const;
  const taskDir = join(projectDir, "data", "tasks", state);
  const taskPath = join(taskDir, `${id}.md`);
  mkdirSync(taskDir, { recursive: true });
  const relativeTaskPath = relative(projectDir, taskPath);
  if (!existsSync(taskPath)) {
    const title = `Add eval fixture for ${candidate.failurePattern.kind} from ${candidate.runId}`;
    const attrs: Record<string, string> = {
      id,
      title,
      status: state,
      priority: "p2",
      area: "modules",
      task_class: "Meta",
      summary:
        `Build a compact eval-harness fixture from ${candidate.runId} covering ${candidate.failurePattern.kind}.`,
      created_at: nowIso,
      updated_at: nowIso,
    };
    writeFileSync(taskPath, serializeFlatFrontMatter(attrs, candidateTaskBody(candidate)));
  }
  return { kind: "task", id, path: relativeTaskPath, state };
}

function candidateTaskBody(candidate: FixtureCandidateRecord): string {
  const artifactRefs = candidate.failurePattern.evidencePaths.length > 0
    ? candidate.failurePattern.evidencePaths
    : [`.kota/runs/${candidate.runId}/metadata.json`];
  return [
    "",
    "## Problem",
    "",
    `Run ${candidate.runId} exposed ${candidate.failurePattern.kind}: ${candidate.failurePattern.summary}`,
    "",
    "## Desired Outcome",
    "",
    "Create or update a compact eval-harness fixture that preserves this local failure pattern without copying secrets, hidden reasoning traces, or full raw event streams.",
    "",
    "## Constraints",
    "",
    "- Use the referenced run artifacts only as provenance and minimal fixture input guidance.",
    "- Prefer deterministic predicates, artifact schema checks, or trajectory checks before model-graded rubrics.",
    "- Do not import external benchmarks or store full raw traces.",
    "",
    "## Done When",
    "",
    "- The eval-harness fixture or focused follow-up test encodes the candidate pattern.",
    "- Fixture provenance names the source run and uses real-failure provenance when applicable.",
    "- `pnpm dev eval list` loads the fixture without provenance or schema errors.",
    "",
    "## Source / Intent",
    "",
    "Auto-created by `kota eval fixture-candidates --create-task` from local autonomy run evidence.",
    "",
    `- Source run: ${candidate.runId}`,
    `- Workflow: ${candidate.workflow}`,
    `- Source task: ${candidate.taskId ?? "unknown"}`,
    `- Pattern: ${candidate.failurePattern.title}`,
    `- Rationale: ${candidate.preservationRationale}`,
    `- Suggested evaluator: ${candidate.suggestedEvaluator}`,
    "- Artifact references:",
    ...artifactRefs.map((path) => `  - ${path}`),
    "- Minimal fixture inputs:",
    ...candidate.minimalFixtureInputs.map((input) => `  - ${input}`),
    "",
    "## Initiative",
    "",
    "Trace-backed eval growth.",
    "",
    "## Product / Safety Link",
    "",
    "Safety: keeps recurring autonomy failures from being patched without a replayable regression target.",
    "",
    "## Acceptance Evidence",
    "",
    "- Focused eval-harness fixture or task transcript showing the candidate pattern is represented without sensitive data.",
    "",
    `<!-- fixture-candidate-fingerprint: ${candidate.proposalFingerprint} -->`,
    "",
  ].join("\n");
}
