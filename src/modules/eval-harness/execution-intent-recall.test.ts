import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildConfiguredProject,
  type ConfiguredProject,
} from "#core/daemon/scope-registry.js";
import {
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { getProjectHistoryStore, resetHistory } from "#modules/history/history.js";
import {
  HistoryProjectStores,
} from "#modules/history/project-scope.js";
import { KnowledgeProjectStores } from "#modules/knowledge/project-scope.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryProjectStores } from "#modules/memory/project-scope.js";
import { MemoryStore } from "#modules/memory/store.js";
import {
  createProjectHistoryContributor,
  createProjectKnowledgeContributor,
  createProjectMemoryContributor,
  createProjectTasksContributor,
} from "#modules/recall/contributors.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import type { RecallProjectContext } from "#modules/recall/recall-types.js";
import { createRecallToolRunner } from "#modules/recall/tool.js";
import { RepoTasksProjectStores } from "#modules/repo-tasks/project-scope.js";
import { RepoTasksDefaultStore } from "#modules/repo-tasks/repo-tasks-store.js";

const HIDDEN_DECISION_MARKER = "TABLE_FIRST_STATUS_RENDERER";
const FIXTURE_PROVENANCE = {
  kind: "smoke-fixture",
  source: "https://github.com/Alienfader/continuity-benchmarks",
  justification:
    "Compact plumbing guard for execution-intent recall: it proves the existing project-scoped recall tool can surface a hidden prior decision before a deterministic code edit, without importing Continuity Benchmarks data or adding a second benchmark runner.",
} as const;

type PredicateResult = {
  passed: boolean;
  detail: string;
};

function runGit(projectDir: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createProject(parent: string): ConfiguredProject {
  const projectDir = join(parent, "project");
  mkdirSync(join(projectDir, "src"), { recursive: true });
  mkdirSync(join(projectDir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
  mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
  runGit(projectDir, ["init", "--quiet", "--initial-branch=main"]);
  runGit(projectDir, ["config", "user.email", "eval-harness@kota.local"]);
  runGit(projectDir, ["config", "user.name", "KOTA Eval Harness"]);
  runGit(projectDir, ["config", "commit.gpgsign", "false"]);
  return buildConfiguredProject({ projectDir });
}

function seedTask(projectDir: string): void {
  writeFileSync(
    join(projectDir, "data", "tasks", "backlog", "task-status-display-card-polish.md"),
    `---
id: task-status-display-card-polish
title: Polish status display card spacing
status: backlog
priority: p3
area: client
summary: Distractor task mentioning operator status display but recommending visual card polish.
created_at: 2026-05-01T00:00:00Z
updated_at: 2026-05-01T00:00:00Z
---

## Problem

This older task concerns screenshot spacing for a promotional status display,
not the operator runtime view.
`,
    "utf-8",
  );
}

function seedPriorState(project: ConfiguredProject): {
  memory: MemoryStore;
  knowledge: KnowledgeStore;
  history: ReturnType<typeof getProjectHistoryStore>;
  tasks: RepoTasksDefaultStore;
  relevantMemoryId: string;
} {
  const memory = new MemoryStore(join(project.projectDir, ".kota"));
  const knowledge = new KnowledgeStore(project.projectDir);
  const history = getProjectHistoryStore(project.projectDir);
  const tasks = new RepoTasksDefaultStore(project.projectDir);

  const relevantMemoryId = memory.save(
    [
      "Architectural decision for operator status display triage scanning renderer:",
      `use ${HIDDEN_DECISION_MARKER}; set layout to table-first and row density to compact-rows.`,
      "Avoid prompt-only comfortable-card interpretations for this execution intent.",
    ].join(" "),
    ["decision", "operator-status"],
  );
  memory.save(
    "Older operator status display note: public launch screenshots may use comfortable cards when the execution intent is marketing review.",
    ["decision", "distractor"],
  );
  knowledge.create({
    title: "Mobile onboarding panel decision",
    content:
      "Use progressive disclosure for first-run mobile onboarding. This is unrelated to runtime supervision pages.",
    tags: ["decision", "distractor"],
  });
  const historyId = history.create("test-model", project.projectDir);
  history.save(
    historyId,
    [
      {
        role: "user",
        content: "Record the prior decision about billing retry copy.",
      },
      {
        role: "assistant",
        content: "Decision saved: billing retry copy should be terse.",
      },
    ],
    0,
    0,
  );
  seedTask(project.projectDir);
  return { memory, knowledge, history, tasks, relevantMemoryId };
}

function buildRecallProvider(
  project: ConfiguredProject,
  stores: ReturnType<typeof seedPriorState>,
): RecallProviderImpl {
  const projectContext: RecallProjectContext = {
    projectId: project.projectId,
    projectDir: project.projectDir,
    knowledge: stores.knowledge,
    memory: stores.memory,
    history: stores.history,
    tasks: stores.tasks,
  };
  const resolveProjectContext = (projectId: string | null | undefined) => {
    const requested = projectId?.trim();
    if (requested && requested !== project.projectId) {
      return { error: "unknown_project" as const, projectId: requested };
    }
    return projectContext;
  };

  const provider = new RecallProviderImpl({
    resolveProjectContext,
    onContributorError: () => {},
  });
  const projects = [project];
  provider.register(
    createProjectKnowledgeContributor(
      new KnowledgeProjectStores({
        defaultProjectDir: project.projectDir,
        defaultProjectId: project.projectId,
        projects,
        getDefaultProvider: () => stores.knowledge,
      }),
    ),
  );
  provider.register(
    createProjectMemoryContributor(
      new MemoryProjectStores({
        defaultProjectDir: project.projectDir,
        defaultProjectId: project.projectId,
        projects,
        getDefaultProvider: () => stores.memory,
      }),
    ),
  );
  provider.register(
    createProjectHistoryContributor(
      new HistoryProjectStores({
        defaultProjectDir: project.projectDir,
        defaultProjectId: project.projectId,
        projects,
        getDefaultProvider: () => stores.history,
      }),
    ),
  );
  provider.register(
    createProjectTasksContributor(
      new RepoTasksProjectStores({
        defaultProjectDir: project.projectDir,
        defaultProjectId: project.projectId,
        projects,
        getDefaultProvider: () => stores.tasks,
      }),
    ),
  );
  return provider;
}

function writeInitialSource(projectDir: string): void {
  writeFileSync(
    join(projectDir, "src", "operator-status.ts"),
    `export const operatorStatusView = {
  layout: "summary-cards",
  rowDensity: "comfortable",
  decision: "unset",
} as const;
`,
    "utf-8",
  );
  runGit(projectDir, ["add", "-A"]);
  runGit(projectDir, ["commit", "--quiet", "-m", "initial execution-intent fixture"]);
}

function applyRecallBackedPatch(projectDir: string, toolOutput: string): string {
  const sourcePath = join(projectDir, "src", "operator-status.ts");
  const current = readFileSync(sourcePath, "utf-8");
  const next = toolOutput.includes(HIDDEN_DECISION_MARKER)
    ? current
        .replace('layout: "summary-cards"', 'layout: "table-first"')
        .replace('rowDensity: "comfortable"', 'rowDensity: "compact-rows"')
        .replace('decision: "unset"', `decision: "${HIDDEN_DECISION_MARKER}"`)
    : current
        .replace('layout: "summary-cards"', 'layout: "comfortable-refresh"')
        .replace('decision: "unset"', 'decision: "prompt-only"');
  writeFileSync(sourcePath, next, "utf-8");
  return runGit(projectDir, ["diff", "--", "src/operator-status.ts"]);
}

function evaluateExecutionIntentPredicate(params: {
  toolOutput: string;
  finalDiff: string;
}): PredicateResult {
  const retrievedDecision = params.toolOutput.includes(HIDDEN_DECISION_MARKER);
  const appliedDecision =
    params.finalDiff.includes('layout: "table-first"') &&
    params.finalDiff.includes('rowDensity: "compact-rows"') &&
    params.finalDiff.includes(`decision: "${HIDDEN_DECISION_MARKER}"`);
  return {
    passed: retrievedDecision && appliedDecision,
    detail:
      `retrievedDecision=${retrievedDecision}; ` +
      `appliedDecision=${appliedDecision}; marker=${HIDDEN_DECISION_MARKER}`,
  };
}

describe("execution-intent recall fixture", () => {
  let root: string;

  beforeEach(() => {
    resetProviderRegistry();
    resetHistory();
    root = mkdtempSync(join(tmpdir(), "kota-execution-intent-recall-"));
  });

  afterEach(() => {
    resetProviderRegistry();
    resetHistory();
    rmSync(root, { recursive: true, force: true });
  });

  it("recovers a hidden prior decision through the session recall tool before patching", async () => {
    const project = createProject(root);
    const stores = seedPriorState(project);
    writeInitialSource(project.projectDir);
    const provider = buildRecallProvider(project, stores);
    const recallTool = createRecallToolRunner(() => provider);

    const laterPrompt =
      "Update the operator status display so repeated triage scans are comfortable.";
    const recallQuery = "operator status display triage scanning renderer";
    expect(laterPrompt).not.toContain(HIDDEN_DECISION_MARKER);
    expect(recallQuery).not.toContain(HIDDEN_DECISION_MARKER);

    const toolResult = await recallTool({ query: recallQuery, topK: 5 });
    expect(toolResult.is_error).toBeUndefined();
    expect(toolResult.content).toContain(HIDDEN_DECISION_MARKER);

    const rankedHits = await provider.recall(recallQuery, { topK: 5 });
    expect(rankedHits[0]).toMatchObject({
      source: "memory",
      id: stores.relevantMemoryId,
    });

    const finalDiff = applyRecallBackedPatch(
      project.projectDir,
      toolResult.content,
    );
    const predicateResult = evaluateExecutionIntentPredicate({
      toolOutput: toolResult.content,
      finalDiff,
    });
    expect(predicateResult.passed).toBe(true);
    expect(
      evaluateExecutionIntentPredicate({
        toolOutput: toolResult.content,
        finalDiff: finalDiff.replace(HIDDEN_DECISION_MARKER, "PROMPT_ONLY_PATCH"),
      }).passed,
    ).toBe(false);

    const artifact = {
      provenance: FIXTURE_PROVENANCE,
      laterPrompt,
      recallQuery,
      rankedHits: rankedHits.map((hit) => ({
        source: hit.source,
        id: hit.id,
        score: hit.score,
      })),
      toolOutput: toolResult.content,
      finalDiff,
      predicateResult,
    };
    const artifactDir = join(
      project.projectDir,
      ".kota",
      "runs",
      "execution-intent-recall-smoke",
    );
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, "verification-artifact.json");
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf-8");

    const written = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      provenance?: { source?: string };
      recallQuery?: string;
      rankedHits?: Array<{ source: string; id: string }>;
      predicateResult?: PredicateResult;
    };
    expect(written.provenance?.source).toBe(FIXTURE_PROVENANCE.source);
    expect(written.recallQuery).toBe(recallQuery);
    expect(written.rankedHits?.[0]).toMatchObject({
      source: "memory",
      id: stores.relevantMemoryId,
    });
    expect(written.predicateResult).toMatchObject({ passed: true });
  });
});
