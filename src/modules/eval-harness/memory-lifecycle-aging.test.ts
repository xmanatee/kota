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
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { getScopeHistoryStore, resetHistory } from "#modules/history/history.js";
import { HistoryScopeStores } from "#modules/history/scope.js";
import { KnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryScopeStores } from "#modules/memory/scope.js";
import { MemoryStore } from "#modules/memory/store.js";
import type { RecallHit } from "#modules/recall/client.js";
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
import {
  getEntry,
  getWorkingMemoryState,
  listEntries,
  resetWorkingMemory,
  setEntry,
} from "#modules/working-memory/store.js";

const INITIAL_POLICY = "AGING_ALPHA_ROUTER_INITIAL";
const CURRENT_POLICY = "AGING_BETA_ROUTER_CURRENT";
const LOW_FREQUENCY_DETAIL = "quartz-17-lantern";
const ARTIFACT_RUN_ID = "memory-lifecycle-aging-smoke";

const FIXTURE_NOTES = [
  "AgingBench (https://arxiv.org/abs/2605.26302) motivates checking agent reliability as a lifespan property of the full harness, not a one-shot recall score.",
  "The AgingBench site (https://agingbench.github.io/) separates compression, interference, revision, and maintenance aging with write/retrieval/utilization diagnostics.",
  "The public benchmark repo (https://github.com/VITA-Group/AgingBench) is cited for framing only; this fixture stays KOTA-owned and does not import external datasets or schemas.",
] as const;

const FIXTURE_PROVENANCE = {
  kind: "smoke-fixture",
  sources: [
    "https://arxiv.org/abs/2605.26302",
    "https://agingbench.github.io/",
    "https://github.com/VITA-Group/AgingBench",
  ],
  justification: FIXTURE_NOTES.join(" "),
} as const;

type PredicateResult = {
  passed: boolean;
  detail: string;
  failures: string[];
};

type CheckpointId =
  | "checkpoint-1-initial-write"
  | "checkpoint-2-revision-with-distractors"
  | "checkpoint-3-post-maintenance";

type WriteRecord = {
  checkpointId: CheckpointId;
  source: "memory" | "knowledge" | "history" | "tasks" | "working-memory";
  id: string;
  marker: string;
};

type EvidenceSelection = {
  selectedCurrentEvidenceIds: string[];
  selectedInitialEvidenceIds: string[];
  ignoredStaleEvidenceIds: string[];
};

type SeededRecords = {
  memory: MemoryStore;
  knowledge: KnowledgeStore;
  history: ReturnType<typeof getScopeHistoryStore>;
  tasks: RepoTasksDefaultStore;
  initialMemoryId: string;
  initialHistoryId: string;
  currentMemoryId: string;
  currentKnowledgeId: string;
  revisionHistoryId: string;
  staleKnowledgeId: string;
  staleTaskId: string;
  distractorHistoryId: string;
};

type CheckpointDiagnostics = {
  checkpointId: CheckpointId;
  prompt: string;
  recallQuery: string;
  writes: WriteRecord[];
  recall: {
    rankedHits: Array<{
      rank: number;
      source: RecallHit["source"];
      id: string;
      score: number;
      text: string;
    }>;
    selectedEvidenceIds: string[];
    ignoredStaleEvidenceIds: string[];
  };
  persistedRecordsAfterMaintenance: "not-yet-run" | PersistedRecords;
  finalBehavior: {
    finalDiff: string;
    usedPolicy: string;
    usedLowFrequencyDetail: string | null;
  };
  predicateResult: PredicateResult;
};

type PersistedRecords = {
  memory: Array<{ id: string; containsCurrentPolicy: boolean; containsDetail: boolean }>;
  knowledge: Array<{ id: string; containsCurrentPolicy: boolean; containsDetail: boolean }>;
  workingMemory: {
    maintenanceKind: "working-memory-compaction";
    compactedNotePresent: boolean;
    persistentTargetSurvived: boolean;
    compactedNoiseEntries: number;
  };
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

function seedConversation(params: {
  history: ReturnType<typeof getScopeHistoryStore>;
  scopeRoot: string;
  firstUserMessage: string;
  assistantMessage: string;
}): string {
  const id = params.history.create("test-model", params.scopeRoot);
  params.history.save(
    id,
    [
      { role: "user", content: params.firstUserMessage },
      { role: "assistant", content: params.assistantMessage },
    ],
    0,
    0,
  );
  return id;
}

function seedInitialState(scope: DirectoryScope): SeededRecords {
  const memory = new MemoryStore(join(scope.scopeRoot, ".kota"));
  const knowledge = new KnowledgeStore(
    scope.scopeRoot,
    join(scope.scopeRoot, ".kota", "global-data"),
  );
  const history = getScopeHistoryStore(scope.scopeRoot);
  const tasks = new RepoTasksDefaultStore(scope.scopeRoot);

  const initialMemoryId = memory.save(
    [
      "Initial lifecycle routing decision for the operator escalation runbook:",
      `use ${INITIAL_POLICY}; audit shard amber-04; owner fallback single-review.`,
      "This is the correct checkpoint-1 decision before the later revision.",
    ].join(" "),
    ["decision", "memory-aging", "current-at-checkpoint-1"],
  );
  const initialHistoryId = seedConversation({
    history,
    scopeRoot: scope.scopeRoot,
    firstUserMessage:
      "Session 1: record the lifecycle routing decision for the operator escalation runbook.",
    assistantMessage:
      `Recorded ${INITIAL_POLICY} with audit shard amber-04 and owner fallback single-review.`,
  });

  return {
    memory,
    knowledge,
    history,
    tasks,
    initialMemoryId,
    initialHistoryId,
    currentMemoryId: "",
    currentKnowledgeId: "",
    revisionHistoryId: "",
    staleKnowledgeId: "",
    staleTaskId: "",
    distractorHistoryId: "",
  };
}

function seedTaskDistractor(scopeRoot: string): string {
  const id = "task-aging-runbook-initial-router-polish";
  writeFileSync(
    join(scopeRoot, "data", "tasks", `${id}.md`),
    `---
status: open
priority: p3
---

# Old lifecycle routing runbook polish ${INITIAL_POLICY}

## Problem

This old task is deliberately similar to the current operator escalation
runbook work, but its initial router guidance is superseded.
`,
    "utf-8",
  );
  return id;
}

function applyRevisionAndDistractors(
  scope: DirectoryScope,
  stores: SeededRecords,
): WriteRecord[] {
  const updatedInitial = stores.memory.update(stores.initialMemoryId, {
    content: [
      "Superseded lifecycle routing decision for the operator escalation runbook:",
      `the old ${INITIAL_POLICY} amber-04 single-review path is retained only as stale evidence.`,
      "Use the later beta-router decision for current release-blocking work.",
    ].join(" "),
    tags: ["decision", "memory-aging", "superseded"],
  });
  if (!updatedInitial) throw new Error("failed to mark initial memory as superseded");

  const currentMemoryId = stores.memory.save(
    [
      "Current lifecycle routing decision for the operator escalation runbook:",
      `use ${CURRENT_POLICY}; low-frequency audit shard ${LOW_FREQUENCY_DETAIL}; owner fallback two-person-review.`,
      "This revision is the active policy for current release-blocking work.",
    ].join(" "),
    ["decision", "memory-aging", "current"],
  );
  const currentKnowledgeId = stores.knowledge.create({
    title: `Current escalation lifecycle routing ${CURRENT_POLICY}`,
    content:
      `Current policy is ${CURRENT_POLICY}; preserve the low-frequency audit shard ${LOW_FREQUENCY_DETAIL} and two-person-review owner fallback after lifecycle maintenance.`,
    tags: ["decision", "memory-aging", "current"],
  });
  const staleKnowledgeId = stores.knowledge.create({
    title: `Superseded escalation lifecycle routing ${INITIAL_POLICY}`,
    content:
      `The old policy ${INITIAL_POLICY} used amber-04 and single-review. It remains as a stale distractor for revision-aging checks.`,
    tags: ["decision", "memory-aging", "superseded"],
  });
  const revisionHistoryId = seedConversation({
    history: stores.history,
    scopeRoot: scope.scopeRoot,
    firstUserMessage:
      "Session 2: revise the operator escalation lifecycle routing decision for the current release.",
    assistantMessage:
      `Revised to ${CURRENT_POLICY}; retain ${LOW_FREQUENCY_DETAIL}; use two-person-review.`,
  });
  const distractorHistoryId = seedConversation({
    history: stores.history,
    scopeRoot: scope.scopeRoot,
    firstUserMessage:
      "Session 2 distractor: brainstorm lifecycle routing visuals for launch slides.",
    assistantMessage:
      "Slide visuals may use colorful routes. This is unrelated to the current escalation runbook.",
  });
  const staleTaskId = seedTaskDistractor(scope.scopeRoot);

  stores.currentMemoryId = currentMemoryId;
  stores.currentKnowledgeId = currentKnowledgeId;
  stores.revisionHistoryId = revisionHistoryId;
  stores.staleKnowledgeId = staleKnowledgeId;
  stores.staleTaskId = staleTaskId;
  stores.distractorHistoryId = distractorHistoryId;

  return [
    {
      checkpointId: "checkpoint-2-revision-with-distractors",
      source: "memory",
      id: stores.initialMemoryId,
      marker: INITIAL_POLICY,
    },
    {
      checkpointId: "checkpoint-2-revision-with-distractors",
      source: "memory",
      id: currentMemoryId,
      marker: CURRENT_POLICY,
    },
    {
      checkpointId: "checkpoint-2-revision-with-distractors",
      source: "knowledge",
      id: currentKnowledgeId,
      marker: CURRENT_POLICY,
    },
    {
      checkpointId: "checkpoint-2-revision-with-distractors",
      source: "knowledge",
      id: staleKnowledgeId,
      marker: INITIAL_POLICY,
    },
    {
      checkpointId: "checkpoint-2-revision-with-distractors",
      source: "history",
      id: revisionHistoryId,
      marker: CURRENT_POLICY,
    },
    {
      checkpointId: "checkpoint-2-revision-with-distractors",
      source: "history",
      id: distractorHistoryId,
      marker: "distractor",
    },
    {
      checkpointId: "checkpoint-2-revision-with-distractors",
      source: "tasks",
      id: staleTaskId,
      marker: INITIAL_POLICY,
    },
  ];
}

function buildRecallProvider(
  scope: DirectoryScope,
  stores: SeededRecords,
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

function writeInitialSourceFile(scopeRoot: string): void {
  writeFileSync(
    join(scopeRoot, "src", "operator-escalation-routing.ts"),
    `export const operatorEscalationRouting = {
  route: "unset",
  auditShard: "unset",
  ownerFallback: "unset",
  revision: "unset",
} as const;
`,
    "utf-8",
  );
}

function writeInitialSource(scopeRoot: string): void {
  writeInitialSourceFile(scopeRoot);
  runGit(scopeRoot, ["add", "-A"]);
  runGit(scopeRoot, ["commit", "--quiet", "-m", "initial memory lifecycle fixture"]);
}

function applyLifecyclePatch(scopeRoot: string, evidenceText: string): {
  finalDiff: string;
  usedPolicy: string;
  usedLowFrequencyDetail: string | null;
} {
  const sourcePath = join(scopeRoot, "src", "operator-escalation-routing.ts");
  const current = readFileSync(sourcePath, "utf-8");
  const hasCurrent =
    evidenceText.includes(CURRENT_POLICY) &&
    evidenceText.includes(LOW_FREQUENCY_DETAIL);
  const hasInitial = evidenceText.includes(INITIAL_POLICY);
  const next = hasCurrent
    ? current
        .replace('route: "unset"', 'route: "beta-router"')
        .replace('auditShard: "unset"', `auditShard: "${LOW_FREQUENCY_DETAIL}"`)
        .replace('ownerFallback: "unset"', 'ownerFallback: "two-person-review"')
        .replace('revision: "unset"', `revision: "${CURRENT_POLICY}"`)
    : hasInitial
      ? current
          .replace('route: "unset"', 'route: "alpha-router"')
          .replace('auditShard: "unset"', 'auditShard: "amber-04"')
          .replace('ownerFallback: "unset"', 'ownerFallback: "single-review"')
          .replace('revision: "unset"', `revision: "${INITIAL_POLICY}"`)
      : current
          .replace('route: "unset"', 'route: "prompt-only"')
          .replace('revision: "unset"', 'revision: "prompt-only"');
  writeFileSync(sourcePath, next, "utf-8");
  return {
    finalDiff: runGit(scopeRoot, ["diff", "--", "src/operator-escalation-routing.ts"]),
    usedPolicy: hasCurrent ? CURRENT_POLICY : hasInitial ? INITIAL_POLICY : "prompt-only",
    usedLowFrequencyDetail: hasCurrent ? LOW_FREQUENCY_DETAIL : null,
  };
}

function hitText(hit: RecallHit): string {
  switch (hit.source) {
    case "knowledge":
      return `${hit.title} ${hit.preview}`;
    case "memory":
      return hit.preview;
    case "history":
      return hit.title;
    case "tasks":
      return hit.title;
    case "answer":
      return `${hit.query} ${hit.preview}`;
  }
}

function summarizeHits(rankedHits: RecallHit[]): CheckpointDiagnostics["recall"]["rankedHits"] {
  return rankedHits.map((hit, index) => ({
    rank: index + 1,
    source: hit.source,
    id: hit.id,
    score: hit.score,
    text: hitText(hit),
  }));
}

function selectEvidence(rankedHits: RecallHit[]): EvidenceSelection {
  const initialEvidenceIds = rankedHits
    .filter((hit) => {
      const text = hitText(hit);
      return text.includes(INITIAL_POLICY) && !text.includes(CURRENT_POLICY);
    })
    .map((hit) => hit.id);
  return {
    selectedCurrentEvidenceIds: rankedHits
      .filter((hit) => {
        const text = hitText(hit);
        return text.includes(CURRENT_POLICY) || text.includes(LOW_FREQUENCY_DETAIL);
      })
      .map((hit) => hit.id),
    selectedInitialEvidenceIds: initialEvidenceIds,
    ignoredStaleEvidenceIds: initialEvidenceIds,
  };
}

function evaluateLifecyclePredicate(params: {
  expectedPolicy: typeof INITIAL_POLICY | typeof CURRENT_POLICY;
  expectedEvidenceIds: string[];
  selection: EvidenceSelection;
  finalDiff: string;
  persistedEvidenceIds?: string[];
  requireStalePresent: boolean;
}): PredicateResult {
  const selectedExpectedEvidence = params.expectedEvidenceIds.every((id) =>
    params.expectedPolicy === CURRENT_POLICY
      ? params.selection.selectedCurrentEvidenceIds.includes(id)
      : params.selection.selectedInitialEvidenceIds.includes(id),
  );
  const persistedExpectedEvidence = params.persistedEvidenceIds
    ? params.expectedEvidenceIds.every((id) => params.persistedEvidenceIds?.includes(id))
    : true;
  const stalePresentWhenExpected =
    !params.requireStalePresent || params.selection.ignoredStaleEvidenceIds.length > 0;
  const appliedExpectedPolicy = params.finalDiff.includes(params.expectedPolicy);
  const appliedCurrentDetail =
    params.expectedPolicy !== CURRENT_POLICY ||
    params.finalDiff.includes(LOW_FREQUENCY_DETAIL);
  const didNotUseStaleForCurrent =
    params.expectedPolicy !== CURRENT_POLICY ||
    !params.finalDiff.includes(`revision: "${INITIAL_POLICY}"`);

  const checks = {
    selectedExpectedEvidence,
    persistedExpectedEvidence,
    stalePresentWhenExpected,
    appliedExpectedPolicy,
    appliedCurrentDetail,
    didNotUseStaleForCurrent,
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    passed: failures.length === 0,
    detail: Object.entries(checks)
      .map(([name, passed]) => `${name}=${passed}`)
      .join("; "),
    failures,
  };
}

function mustSetWorkingMemory(
  key: string,
  value: string,
  persistent?: boolean,
): void {
  const error = setEntry(key, value, persistent);
  if (error) throw new Error(error);
}

function runMaintenanceShock(): PersistedRecords["workingMemory"] {
  resetWorkingMemory();
  mustSetWorkingMemory(
    "target-decision",
    `Keep ${CURRENT_POLICY} and ${LOW_FREQUENCY_DETAIL} visible through maintenance.`,
    true,
  );
  for (let index = 0; index < 16; index++) {
    mustSetWorkingMemory(
      `noise-${index}`,
      `noise ${index} `.padEnd(202, "x"),
      false,
    );
  }

  const renderedState = getWorkingMemoryState();
  const target = getEntry("target-decision");
  const compactedNoiseEntries = listEntries().filter(
    (entry) => entry.key.startsWith("noise-") && entry.value.length <= 201,
  ).length;
  return {
    maintenanceKind: "working-memory-compaction",
    compactedNotePresent: renderedState.includes("<working-memory-compacted>"),
    persistentTargetSurvived:
      target?.value.includes(CURRENT_POLICY) === true &&
      target.value.includes(LOW_FREQUENCY_DETAIL),
    compactedNoiseEntries,
  };
}

function persistedRecordsAfterMaintenance(stores: SeededRecords): PersistedRecords {
  return {
    memory: stores.memory.list().map((entry) => ({
      id: entry.id,
      containsCurrentPolicy: entry.content.includes(CURRENT_POLICY),
      containsDetail: entry.content.includes(LOW_FREQUENCY_DETAIL),
    })),
    knowledge: stores.knowledge.list().map((entry) => ({
      id: entry.id,
      containsCurrentPolicy: entry.content.includes(CURRENT_POLICY),
      containsDetail: entry.content.includes(LOW_FREQUENCY_DETAIL),
    })),
    workingMemory: runMaintenanceShock(),
  };
}

function persistedCurrentEvidenceIds(records: PersistedRecords): string[] {
  return [
    ...records.memory
      .filter((entry) => entry.containsCurrentPolicy && entry.containsDetail)
      .map((entry) => entry.id),
    ...records.knowledge
      .filter((entry) => entry.containsCurrentPolicy && entry.containsDetail)
      .map((entry) => entry.id),
  ];
}

async function runCheckpoint(params: {
  checkpointId: CheckpointId;
  scopeRoot: string;
  provider: RecallProviderImpl;
  prompt: string;
  recallQuery: string;
  writes: WriteRecord[];
  expectedPolicy: typeof INITIAL_POLICY | typeof CURRENT_POLICY;
  expectedEvidenceIds: string[];
  persistedRecordsAfterMaintenance: "not-yet-run" | PersistedRecords;
  requireStalePresent: boolean;
}): Promise<CheckpointDiagnostics> {
  const recallTool = createRecallToolRunner(() => params.provider);
  const toolResult = await recallTool({ query: params.recallQuery, topK: 10 });
  if (toolResult.is_error) {
    throw new Error(toolResult.content);
  }
  const recallResult = await params.provider.recall(params.recallQuery, { topK: 10 });
  if (!recallResult.ok) throw new Error("expected recall hits");
  const rankedHits = recallResult.hits;
  const rawSelection = selectEvidence(rankedHits);
  const selection: EvidenceSelection = params.expectedPolicy === INITIAL_POLICY
    ? { ...rawSelection, ignoredStaleEvidenceIds: [] }
    : rawSelection;

  writeInitialSourceFile(params.scopeRoot);
  const finalBehavior = applyLifecyclePatch(params.scopeRoot, toolResult.content);
  const predicateResult = evaluateLifecyclePredicate({
    expectedPolicy: params.expectedPolicy,
    expectedEvidenceIds: params.expectedEvidenceIds,
    selection,
    finalDiff: finalBehavior.finalDiff,
    persistedEvidenceIds:
      params.persistedRecordsAfterMaintenance === "not-yet-run"
        ? undefined
        : persistedCurrentEvidenceIds(params.persistedRecordsAfterMaintenance),
    requireStalePresent: params.requireStalePresent,
  });

  return {
    checkpointId: params.checkpointId,
    prompt: params.prompt,
    recallQuery: params.recallQuery,
    writes: params.writes,
    recall: {
      rankedHits: summarizeHits(rankedHits),
      selectedEvidenceIds:
        params.expectedPolicy === CURRENT_POLICY
          ? selection.selectedCurrentEvidenceIds
          : selection.selectedInitialEvidenceIds,
      ignoredStaleEvidenceIds: selection.ignoredStaleEvidenceIds,
    },
    persistedRecordsAfterMaintenance: params.persistedRecordsAfterMaintenance,
    finalBehavior,
    predicateResult,
  };
}

function buildNegativeChecks(params: {
  currentMemoryId: string;
  currentKnowledgeId: string;
  staleIds: string[];
  scopeRoot: string;
  persistedRecords: PersistedRecords;
}): {
  staleRevisionUse: { finalDiff: string; predicateResult: PredicateResult };
  targetEvidenceLossAfterMaintenance: PredicateResult;
  promptOnlySuccess: { finalDiff: string; predicateResult: PredicateResult };
} {
  writeInitialSourceFile(params.scopeRoot);
  const stalePatch = applyLifecyclePatch(params.scopeRoot, INITIAL_POLICY);
  const staleRevisionUse = evaluateLifecyclePredicate({
    expectedPolicy: CURRENT_POLICY,
    expectedEvidenceIds: [params.currentMemoryId, params.currentKnowledgeId],
    selection: {
      selectedCurrentEvidenceIds: [],
      selectedInitialEvidenceIds: params.staleIds,
      ignoredStaleEvidenceIds: params.staleIds,
    },
    finalDiff: stalePatch.finalDiff,
    persistedEvidenceIds: persistedCurrentEvidenceIds(params.persistedRecords),
    requireStalePresent: true,
  });

  const lossAfterMaintenance = evaluateLifecyclePredicate({
    expectedPolicy: CURRENT_POLICY,
    expectedEvidenceIds: [params.currentMemoryId, params.currentKnowledgeId],
    selection: {
      selectedCurrentEvidenceIds: [params.currentMemoryId, params.currentKnowledgeId],
      selectedInitialEvidenceIds: [],
      ignoredStaleEvidenceIds: params.staleIds,
    },
    finalDiff: stalePatch.finalDiff.replace(INITIAL_POLICY, CURRENT_POLICY),
    persistedEvidenceIds: [params.currentMemoryId],
    requireStalePresent: true,
  });

  writeInitialSourceFile(params.scopeRoot);
  const promptOnlyPatch = applyLifecyclePatch(params.scopeRoot, "");
  const promptOnlySuccess = evaluateLifecyclePredicate({
    expectedPolicy: CURRENT_POLICY,
    expectedEvidenceIds: [params.currentMemoryId, params.currentKnowledgeId],
    selection: {
      selectedCurrentEvidenceIds: [],
      selectedInitialEvidenceIds: [],
      ignoredStaleEvidenceIds: [],
    },
    finalDiff: promptOnlyPatch.finalDiff,
    persistedEvidenceIds: persistedCurrentEvidenceIds(params.persistedRecords),
    requireStalePresent: true,
  });

  return {
    staleRevisionUse: {
      finalDiff: stalePatch.finalDiff,
      predicateResult: staleRevisionUse,
    },
    targetEvidenceLossAfterMaintenance: lossAfterMaintenance,
    promptOnlySuccess: {
      finalDiff: promptOnlyPatch.finalDiff,
      predicateResult: promptOnlySuccess,
    },
  };
}

function writeVerificationArtifact(params: {
  scopeRoot: string;
  artifact: unknown;
}): string {
  const artifactDir = join(params.scopeRoot, ".kota", "runs", ARTIFACT_RUN_ID);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "verification-artifact.json");
  writeFileSync(artifactPath, JSON.stringify(params.artifact, null, 2), "utf-8");

  const externalRunDir = process.env.KOTA_RUN_DIR;
  if (externalRunDir) {
    mkdirSync(externalRunDir, { recursive: true });
    writeFileSync(
      join(externalRunDir, "memory-lifecycle-aging-verification.json"),
      JSON.stringify(params.artifact, null, 2),
      "utf-8",
    );
  }

  return artifactPath;
}

describe("memory lifecycle aging fixture", () => {
  let root: string;

  beforeEach(() => {
    resetProviderRegistry();
    resetHistory();
    resetWorkingMemory();
    root = mkdtempSync(join(tmpdir(), "kota-memory-lifecycle-aging-"));
  });

  afterEach(() => {
    resetProviderRegistry();
    resetHistory();
    resetWorkingMemory();
    rmSync(root, { recursive: true, force: true });
  });

  it("retains, revises, retrieves, and uses current evidence across maintenance aging", async () => {
    const scope = createProject(root);
    const stores = seedInitialState(scope);
    writeInitialSource(scope.scopeRoot);
    const initialWrites: WriteRecord[] = [
      {
        checkpointId: "checkpoint-1-initial-write",
        source: "memory",
        id: stores.initialMemoryId,
        marker: INITIAL_POLICY,
      },
      {
        checkpointId: "checkpoint-1-initial-write",
        source: "history",
        id: stores.initialHistoryId,
        marker: INITIAL_POLICY,
      },
    ];
    const provider = buildRecallProvider(scope, stores);

    const firstCheckpoint = await runCheckpoint({
      checkpointId: "checkpoint-1-initial-write",
      scopeRoot: scope.scopeRoot,
      provider,
      prompt:
        "Session 1 check: update the operator escalation runbook with the recorded routing policy.",
      recallQuery: "operator escalation lifecycle routing runbook audit owner",
      writes: initialWrites,
      expectedPolicy: INITIAL_POLICY,
      expectedEvidenceIds: [stores.initialMemoryId],
      persistedRecordsAfterMaintenance: "not-yet-run",
      requireStalePresent: false,
    });
    expect(firstCheckpoint.predicateResult.passed).toBe(true);

    const revisionWrites = applyRevisionAndDistractors(scope, stores);
    const secondCheckpoint = await runCheckpoint({
      checkpointId: "checkpoint-2-revision-with-distractors",
      scopeRoot: scope.scopeRoot,
      provider,
      prompt:
        "Session 2 check: update the current release-blocking escalation runbook after similar notes accumulated.",
      recallQuery:
        "current operator escalation lifecycle routing runbook audit shard owner release",
      writes: revisionWrites,
      expectedPolicy: CURRENT_POLICY,
      expectedEvidenceIds: [stores.currentMemoryId, stores.currentKnowledgeId],
      persistedRecordsAfterMaintenance: "not-yet-run",
      requireStalePresent: true,
    });
    expect(secondCheckpoint.predicateResult.passed).toBe(true);
    expect(secondCheckpoint.recall.ignoredStaleEvidenceIds).toEqual(
      expect.arrayContaining([
        stores.initialMemoryId,
        stores.staleKnowledgeId,
        stores.staleTaskId,
      ]),
    );

    const maintenanceRecords = persistedRecordsAfterMaintenance(stores);
    expect(maintenanceRecords.workingMemory.compactedNotePresent).toBe(true);
    expect(maintenanceRecords.workingMemory.persistentTargetSurvived).toBe(true);
    expect(maintenanceRecords.workingMemory.compactedNoiseEntries).toBeGreaterThan(0);

    const postMaintenanceWrites: WriteRecord[] = [
      {
        checkpointId: "checkpoint-3-post-maintenance",
        source: "working-memory",
        id: "target-decision",
        marker: CURRENT_POLICY,
      },
    ];
    const thirdCheckpoint = await runCheckpoint({
      checkpointId: "checkpoint-3-post-maintenance",
      scopeRoot: scope.scopeRoot,
      provider,
      prompt:
        "Session 3 check after maintenance: apply the escalation routing decision without a precomputed summary.",
      recallQuery:
        "current operator escalation lifecycle routing runbook audit shard owner release",
      writes: postMaintenanceWrites,
      expectedPolicy: CURRENT_POLICY,
      expectedEvidenceIds: [stores.currentMemoryId, stores.currentKnowledgeId],
      persistedRecordsAfterMaintenance: maintenanceRecords,
      requireStalePresent: true,
    });
    expect(thirdCheckpoint.predicateResult.passed).toBe(true);
    expect(thirdCheckpoint.finalBehavior.finalDiff).toContain(LOW_FREQUENCY_DETAIL);

    const negativeChecks = buildNegativeChecks({
      currentMemoryId: stores.currentMemoryId,
      currentKnowledgeId: stores.currentKnowledgeId,
      staleIds: [
        stores.initialMemoryId,
        stores.staleKnowledgeId,
        stores.staleTaskId,
      ],
      scopeRoot: scope.scopeRoot,
      persistedRecords: maintenanceRecords,
    });
    expect(negativeChecks.staleRevisionUse.predicateResult.passed).toBe(false);
    expect(negativeChecks.targetEvidenceLossAfterMaintenance.passed).toBe(false);
    expect(negativeChecks.promptOnlySuccess.predicateResult.passed).toBe(false);

    const checkpoints = [firstCheckpoint, secondCheckpoint, thirdCheckpoint];
    const objectiveMetrics = {
      checkpointPassRate:
        checkpoints.filter((checkpoint) => checkpoint.predicateResult.passed).length /
        checkpoints.length,
      staleHitCount: checkpoints.reduce(
        (sum, checkpoint) => sum + checkpoint.recall.ignoredStaleEvidenceIds.length,
        0,
      ),
      postShockRecovery: thirdCheckpoint.predicateResult.passed ? 1 : 0,
      postShockCurrentEvidenceCount: thirdCheckpoint.recall.selectedEvidenceIds.length,
    };

    const artifact = {
      implementationKind: "focused-eval-harness-backed-module-test",
      runnerNote:
        "The shipped fixture runner invokes workflows; this deterministic lifecycle canary stays in the eval-harness module and exercises KOTA stores, recall contributors, working-memory compaction, predicates, and objective metrics directly.",
      provenance: FIXTURE_PROVENANCE,
      fixtureNotes: FIXTURE_NOTES,
      checkpoints,
      negativeChecks,
      objectiveMetrics,
    };
    const artifactPath = writeVerificationArtifact({
      scopeRoot: scope.scopeRoot,
      artifact,
    });

    const written = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      checkpoints?: CheckpointDiagnostics[];
      negativeChecks?: {
        staleRevisionUse?: { predicateResult?: PredicateResult };
        targetEvidenceLossAfterMaintenance?: PredicateResult;
        promptOnlySuccess?: { predicateResult?: PredicateResult };
      };
      objectiveMetrics?: { checkpointPassRate?: number; postShockRecovery?: number };
    };
    expect(written.checkpoints).toHaveLength(3);
    expect(written.checkpoints?.[2]?.persistedRecordsAfterMaintenance).not.toBe(
      "not-yet-run",
    );
    expect(written.negativeChecks?.staleRevisionUse?.predicateResult).toMatchObject({
      passed: false,
    });
    expect(written.negativeChecks?.targetEvidenceLossAfterMaintenance).toMatchObject({
      passed: false,
    });
    expect(written.negativeChecks?.promptOnlySuccess?.predicateResult).toMatchObject({
      passed: false,
    });
    expect(written.objectiveMetrics).toMatchObject({
      checkpointPassRate: 1,
      postShockRecovery: 1,
    });
  });
});
