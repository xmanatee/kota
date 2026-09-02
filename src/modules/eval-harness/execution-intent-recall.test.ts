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
  buildDirectoryScope,
  type DirectoryScope,
} from "#core/daemon/scope-registry.js";
import {
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { getScopeHistoryStore } from "#modules/history/history.js";
import {
  HistoryScopeStores,
} from "#modules/history/scope.js";
import { KnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryScopeStores } from "#modules/memory/scope.js";
import { MemoryStore } from "#modules/memory/store.js";
import {
  createScopeHistoryContributor,
  createScopeKnowledgeContributor,
  createScopeMemoryContributor,
  createScopeTasksContributor,
} from "#modules/recall/contributors.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import type { RecallScopeContext } from "#modules/recall/recall-types.js";
import { createRecallToolRunner } from "#modules/recall/tool.js";
import { RepoTasksDefaultStore } from "#modules/repo-tasks/repo-tasks-store.js";
import { RepoTasksScopeStores } from "#modules/repo-tasks/scope.js";

const HIDDEN_DECISION_MARKER = "TABLE_FIRST_STATUS_RENDERER";
const FIXTURE_PROVENANCE = {
  kind: "smoke-fixture",
  source: "https://github.com/Alienfader/continuity-benchmarks",
  justification:
    "Compact plumbing guard for execution-intent recall: it proves the existing scope-scoped recall tool can surface a hidden prior decision before a deterministic code edit, without importing Continuity Benchmarks data or adding a second benchmark runner.",
} as const;

type PredicateResult = {
  passed: boolean;
  detail: string;
};

function runGit(scopeRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: scopeRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createProject(parent: string): DirectoryScope {
  const scopeRoot = join(parent, "scope");
  mkdirSync(join(scopeRoot, "src"), { recursive: true });
  mkdirSync(join(scopeRoot, "data", "tasks"), { recursive: true });
  mkdirSync(join(scopeRoot, ".kota", "runs"), { recursive: true });
  runGit(scopeRoot, ["init", "--quiet", "--initial-branch=main"]);
  runGit(scopeRoot, ["config", "user.email", "eval-harness@kota.local"]);
  runGit(scopeRoot, ["config", "user.name", "KOTA Eval Harness"]);
  runGit(scopeRoot, ["config", "commit.gpgsign", "false"]);
  return buildDirectoryScope({ scopeRoot });
}

function seedTask(scopeRoot: string): void {
  writeFileSync(
    join(scopeRoot, "data", "tasks", "task-status-display-card-polish.md"),
    `---
status: open
priority: p3
---

# Polish status display card spacing

## Problem

This older task concerns screenshot spacing for a promotional status display,
not the operator runtime view.
`,
    "utf-8",
  );
}

function seedPriorState(scope: DirectoryScope): {
  memory: MemoryStore;
  knowledge: KnowledgeStore;
  history: ReturnType<typeof getScopeHistoryStore>;
  tasks: RepoTasksDefaultStore;
  relevantMemoryId: string;
} {
  const memory = new MemoryStore(join(scope.scopeRoot, ".kota"));
  const knowledge = new KnowledgeStore(scope.scopeRoot);
  const history = getScopeHistoryStore(scope.scopeRoot);
  const tasks = new RepoTasksDefaultStore(scope.scopeRoot);

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
  const historyId = history.create("test-model", scope.scopeRoot);
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
  seedTask(scope.scopeRoot);
  return { memory, knowledge, history, tasks, relevantMemoryId };
}

function buildRecallProvider(
  scope: DirectoryScope,
  stores: ReturnType<typeof seedPriorState>,
): RecallProviderImpl {
  const scopeContext: RecallScopeContext = {
    scopeId: scope.scopeId,
    scopeRoot: scope.scopeRoot,
    knowledge: stores.knowledge,
    memory: stores.memory,
    history: stores.history,
    tasks: stores.tasks,
  };
  const resolveScopeContext = (scopeId: string | null | undefined) => {
    const requested = scopeId?.trim();
    if (requested && requested !== scope.scopeId) {
      return { error: "unknown_scope" as const, scopeId: requested };
    }
    return scopeContext;
  };

  const provider = new RecallProviderImpl({
    resolveScopeContext,
    onContributorError: () => {},
  });
  const scopes = [scope];
  provider.register(
    createScopeKnowledgeContributor(
      new KnowledgeScopeStores({
        defaultScopeRoot: scope.scopeRoot,
        defaultScopeId: scope.scopeId,
        scopes,
        getDefaultProvider: () => stores.knowledge,
      }),
    ),
  );
  provider.register(
    createScopeMemoryContributor(
      new MemoryScopeStores({
        defaultScopeRoot: scope.scopeRoot,
        defaultScopeId: scope.scopeId,
        scopes,
        getDefaultProvider: () => stores.memory,
      }),
    ),
  );
  provider.register(
    createScopeHistoryContributor(
      new HistoryScopeStores({
        defaultScopeRoot: scope.scopeRoot,
        defaultScopeId: scope.scopeId,
        scopes,
        getDefaultProvider: () => stores.history,
      }),
    ),
  );
  provider.register(
    createScopeTasksContributor(
      new RepoTasksScopeStores({
        defaultScopeRoot: scope.scopeRoot,
        defaultScopeId: scope.scopeId,
        scopes,
        getDefaultProvider: () => stores.tasks,
      }),
    ),
  );
  return provider;
}

function writeInitialSource(scopeRoot: string): void {
  writeFileSync(
    join(scopeRoot, "src", "operator-status.ts"),
    `export const operatorStatusView = {
  layout: "summary-cards",
  rowDensity: "comfortable",
  decision: "unset",
} as const;
`,
    "utf-8",
  );
  runGit(scopeRoot, ["add", "-A"]);
  runGit(scopeRoot, ["commit", "--quiet", "-m", "initial execution-intent fixture"]);
}

function applyRecallBackedPatch(scopeRoot: string, toolOutput: string): string {
  const sourcePath = join(scopeRoot, "src", "operator-status.ts");
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
  return runGit(scopeRoot, ["diff", "--", "src/operator-status.ts"]);
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
    root = mkdtempSync(join(tmpdir(), "kota-execution-intent-recall-"));
  });

  afterEach(() => {
    resetProviderRegistry();
    rmSync(root, { recursive: true, force: true });
  });

  it("recovers a hidden prior decision through the session recall tool before patching", async () => {
    const scope = createProject(root);
    const stores = seedPriorState(scope);
    writeInitialSource(scope.scopeRoot);
    const provider = buildRecallProvider(scope, stores);
    const recallTool = createRecallToolRunner(() => provider);

    const laterPrompt =
      "Update the operator status display so repeated triage scans are comfortable.";
    const recallQuery = "operator status display triage scanning renderer";
    expect(laterPrompt).not.toContain(HIDDEN_DECISION_MARKER);
    expect(recallQuery).not.toContain(HIDDEN_DECISION_MARKER);

    const toolResult = await recallTool({ query: recallQuery, topK: 5 });
    expect(toolResult.is_error).toBeUndefined();
    expect(toolResult.content).toContain(HIDDEN_DECISION_MARKER);

    const recallResult = await provider.recall(recallQuery, { topK: 5 });
    if (!recallResult.ok) throw new Error("expected recall hits");
    const rankedHits = recallResult.hits;
    expect(rankedHits[0]).toMatchObject({
      source: "memory",
      id: stores.relevantMemoryId,
    });

    const finalDiff = applyRecallBackedPatch(
      scope.scopeRoot,
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
      scope.scopeRoot,
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
