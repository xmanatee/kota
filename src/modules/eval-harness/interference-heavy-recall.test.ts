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
} from "#core/daemon/project-registry.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { getProjectHistoryStore, resetHistory } from "#modules/history/history.js";
import { HistoryProjectStores } from "#modules/history/project-scope.js";
import { KnowledgeProjectStores } from "#modules/knowledge/project-scope.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryProjectStores } from "#modules/memory/project-scope.js";
import { MemoryStore } from "#modules/memory/store.js";
import type { RecallHit } from "#modules/recall/client.js";
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

const CURRENT_RENDER_DECISION = "INTERFERENCE_CURRENT_TIMELINE_RENDERER";
const CURRENT_AUDIT_DECISION = "INTERFERENCE_CURRENT_AUDIT_LEDGER";
const STALE_DECISION = "INTERFERENCE_STALE_CARD_CACHE_RULE";
const ARTIFACT_RUN_ID = "interference-heavy-recall-smoke";

const FIXTURE_NOTES = [
  "LongMINT (https://arxiv.org/abs/2605.18565) motivates this compact fixture shape: revised information, interference-heavy memories, and multi-target aggregation over more than one relevant fact.",
  "Continuity Benchmarks (https://github.com/Alienfader/continuity-benchmarks) motivates execution-intent recall, but this fixture stays KOTA-owned and uses the repo's own project-scoped stores instead of vendoring external data.",
  "Provenance kind is smoke-fixture because this is a deterministic plumbing guard for KOTA's recall path rather than a replay of one historical failure.",
] as const;

const FIXTURE_PROVENANCE = {
  kind: "smoke-fixture",
  sources: [
    "https://arxiv.org/abs/2605.18565",
    "https://github.com/Alienfader/continuity-benchmarks",
  ],
  justification: FIXTURE_NOTES.join(" "),
} as const;

type PredicateResult = {
  passed: boolean;
  detail: string;
};

type SeededRecords = {
  memory: MemoryStore;
  knowledge: KnowledgeStore;
  history: ReturnType<typeof getProjectHistoryStore>;
  tasks: RepoTasksDefaultStore;
  currentRenderMemoryId: string;
  currentAuditKnowledgeId: string;
  staleMemoryId: string;
  staleKnowledgeId: string;
  staleTaskId: string;
  historyDistractorId: string;
};

type EvidenceSelection = {
  currentEvidenceIds: string[];
  ignoredStaleEvidenceIds: string[];
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

function seedTaskDistractor(projectDir: string): string {
  const id = "task-incident-handoff-card-cache-polish";
  writeFileSync(
    join(projectDir, "data", "tasks", "backlog", `${id}.md`),
    `---
id: ${id}
title: Incident handoff stale card cache polish ${STALE_DECISION}
status: backlog
priority: p3
area: client
summary: Distractor task with old incident handoff renderer language and cache-only audit evidence.
created_at: 2026-05-01T00:00:00Z
updated_at: 2026-05-01T00:00:00Z
---

## Problem

This old task predates the current release-blocker review. It mentions incident
handoff renderer work, but its cards-first cache-only guidance is superseded.
`,
    "utf-8",
  );
  return id;
}

function seedPriorState(project: ConfiguredProject): SeededRecords {
  const memory = new MemoryStore(join(project.projectDir, ".kota"));
  const knowledge = new KnowledgeStore(
    project.projectDir,
    join(project.projectDir, ".kota", "global-data"),
  );
  const history = getProjectHistoryStore(project.projectDir);
  const tasks = new RepoTasksDefaultStore(project.projectDir);

  const staleMemoryId = memory.save(
    [
      "Superseded incident handoff renderer decision from 2026-04-10:",
      `use ${STALE_DECISION}; keep layout cards-first and evidence storage cache-only.`,
      "This note is semantically close to current release-blocker review work but is no longer current.",
    ].join(" "),
    ["decision", "incident-handoff", "superseded"],
  );
  const currentRenderMemoryId = memory.save(
    [
      "Current incident handoff renderer decision for release-blocker reviews:",
      `use ${CURRENT_RENDER_DECISION}; set layout to timeline-lanes and owner density to concise.`,
      "This revision supersedes cards-first incident handoff renderer notes.",
    ].join(" "),
    ["decision", "incident-handoff", "current"],
  );
  memory.save(
    "Incident handoff marketing screenshots can use spacious cards; this does not apply to runtime release-blocker reviews.",
    ["decision", "distractor"],
  );

  const staleKnowledgeId = knowledge.create({
    title: `Superseded incident handoff cache audit ${STALE_DECISION}`,
    content:
      "Old audit guidance used cache-only evidence for the incident handoff view. It is retained as a distractor so recall must ignore superseded guidance.",
    tags: ["decision", "incident-handoff", "superseded"],
  });
  const currentAuditKnowledgeId = knowledge.create({
    title: `Current incident handoff audit evidence ${CURRENT_AUDIT_DECISION}`,
    content:
      "The current release-blocker review requires a durable audit ledger and a multi-source blocker summary. This current decision is separate from the renderer decision and both must be applied together.",
    tags: ["decision", "incident-handoff", "current"],
  });

  const historyDistractorId = history.create("test-model", project.projectDir);
  history.save(
    historyDistractorId,
    [
      {
        role: "user",
        content:
          "incident handoff current release renderer audit brainstorming for demo cards",
      },
      {
        role: "assistant",
        content:
          "Demo-only cards can be useful in slides, but they are not the runtime release-blocker rule.",
      },
    ],
    0,
    0,
  );

  const staleTaskId = seedTaskDistractor(project.projectDir);

  return {
    memory,
    knowledge,
    history,
    tasks,
    currentRenderMemoryId,
    currentAuditKnowledgeId,
    staleMemoryId,
    staleKnowledgeId,
    staleTaskId,
    historyDistractorId,
  };
}

function buildRecallProvider(
  project: ConfiguredProject,
  stores: SeededRecords,
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

function writeInitialSourceFile(projectDir: string): void {
  writeFileSync(
    join(projectDir, "src", "incident-handoff.ts"),
    `export const incidentHandoffView = {
  layout: "cards-first",
  evidenceStore: "local-cache",
  blockerSummary: "single-source",
  revision: "unset",
} as const;
`,
    "utf-8",
  );
}

function writeInitialSource(projectDir: string): void {
  writeInitialSourceFile(projectDir);
  runGit(projectDir, ["add", "-A"]);
  runGit(projectDir, ["commit", "--quiet", "-m", "initial interference recall fixture"]);
}

function applyRecallBackedPatch(projectDir: string, toolOutput: string): string {
  const sourcePath = join(projectDir, "src", "incident-handoff.ts");
  const current = readFileSync(sourcePath, "utf-8");
  const hasCurrentRenderer = toolOutput.includes(CURRENT_RENDER_DECISION);
  const hasCurrentAudit = toolOutput.includes(CURRENT_AUDIT_DECISION);
  const hasOnlyStale =
    toolOutput.includes(STALE_DECISION) &&
    !(hasCurrentRenderer && hasCurrentAudit);
  const next = hasCurrentRenderer && hasCurrentAudit
    ? current
        .replace('layout: "cards-first"', 'layout: "timeline-lanes"')
        .replace('evidenceStore: "local-cache"', 'evidenceStore: "durable-audit-ledger"')
        .replace('blockerSummary: "single-source"', 'blockerSummary: "multi-source-release-blockers"')
        .replace(
          'revision: "unset"',
          `revision: "${CURRENT_RENDER_DECISION}+${CURRENT_AUDIT_DECISION}"`,
        )
    : hasOnlyStale
      ? current
          .replace('layout: "cards-first"', 'layout: "cards-first-stale"')
          .replace('revision: "unset"', `revision: "${STALE_DECISION}"`)
      : current.replace('revision: "unset"', 'revision: "prompt-only"');
  writeFileSync(sourcePath, next, "utf-8");
  return runGit(projectDir, ["diff", "--", "src/incident-handoff.ts"]);
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

function selectEvidence(rankedHits: RecallHit[]): EvidenceSelection {
  const currentEvidenceIds = rankedHits
    .filter((hit) => {
      const text = hitText(hit);
      return (
        text.includes(CURRENT_RENDER_DECISION) ||
        text.includes(CURRENT_AUDIT_DECISION)
      );
    })
    .map((hit) => hit.id);
  const ignoredStaleEvidenceIds = rankedHits
    .filter((hit) => hitText(hit).includes(STALE_DECISION))
    .map((hit) => hit.id);
  return { currentEvidenceIds, ignoredStaleEvidenceIds };
}

function evaluateInterferencePredicate(params: {
  expectedRenderId: string;
  expectedAuditId: string;
  selection: EvidenceSelection;
  finalDiff: string;
}): PredicateResult {
  const selectedCurrentRenderer = params.selection.currentEvidenceIds.includes(
    params.expectedRenderId,
  );
  const selectedCurrentAudit = params.selection.currentEvidenceIds.includes(
    params.expectedAuditId,
  );
  const staleWasPresentAndIgnored =
    params.selection.ignoredStaleEvidenceIds.length > 0 &&
    !params.selection.ignoredStaleEvidenceIds.some((id) =>
      params.selection.currentEvidenceIds.includes(id),
    );
  const appliedCurrentPatch =
    params.finalDiff.includes('layout: "timeline-lanes"') &&
    params.finalDiff.includes('evidenceStore: "durable-audit-ledger"') &&
    params.finalDiff.includes('blockerSummary: "multi-source-release-blockers"') &&
    params.finalDiff.includes(CURRENT_RENDER_DECISION) &&
    params.finalDiff.includes(CURRENT_AUDIT_DECISION) &&
    !params.finalDiff.includes(STALE_DECISION);
  return {
    passed:
      selectedCurrentRenderer &&
      selectedCurrentAudit &&
      staleWasPresentAndIgnored &&
      appliedCurrentPatch,
    detail:
      `selectedCurrentRenderer=${selectedCurrentRenderer}; ` +
      `selectedCurrentAudit=${selectedCurrentAudit}; ` +
      `staleWasPresentAndIgnored=${staleWasPresentAndIgnored}; ` +
      `appliedCurrentPatch=${appliedCurrentPatch}`,
  };
}

function writeVerificationArtifact(params: {
  projectDir: string;
  artifact: unknown;
}): string {
  const artifactDir = join(params.projectDir, ".kota", "runs", ARTIFACT_RUN_ID);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "verification-artifact.json");
  writeFileSync(artifactPath, JSON.stringify(params.artifact, null, 2), "utf-8");

  const externalRunDir = process.env.KOTA_RUN_DIR;
  if (externalRunDir) {
    mkdirSync(externalRunDir, { recursive: true });
    writeFileSync(
      join(externalRunDir, "interference-heavy-recall-verification.json"),
      JSON.stringify(params.artifact, null, 2),
      "utf-8",
    );
  }

  return artifactPath;
}

describe("interference-heavy recall fixture", () => {
  let root: string;

  beforeEach(() => {
    resetProviderRegistry();
    resetHistory();
    root = mkdtempSync(join(tmpdir(), "kota-interference-heavy-recall-"));
  });

  afterEach(() => {
    resetProviderRegistry();
    resetHistory();
    rmSync(root, { recursive: true, force: true });
  });

  it("applies revised multi-hit evidence while ignoring stale and noisy recall hits", async () => {
    const project = createProject(root);
    const stores = seedPriorState(project);
    writeInitialSource(project.projectDir);
    const provider = buildRecallProvider(project, stores);
    const recallTool = createRecallToolRunner(() => provider);

    const laterPrompt =
      "Update the incident handoff view for the current release-blocking review.";
    const recallQuery = "incident handoff current release renderer audit";
    expect(laterPrompt).not.toContain(CURRENT_RENDER_DECISION);
    expect(laterPrompt).not.toContain(CURRENT_AUDIT_DECISION);
    expect(laterPrompt).not.toContain(STALE_DECISION);
    expect(laterPrompt).not.toContain("timeline-lanes");
    expect(laterPrompt).not.toContain("durable-audit-ledger");

    const toolResult = await recallTool({ query: recallQuery, topK: 8 });
    expect(toolResult.is_error).toBeUndefined();
    expect(toolResult.content).toContain(CURRENT_RENDER_DECISION);
    expect(toolResult.content).toContain(CURRENT_AUDIT_DECISION);
    expect(toolResult.content).toContain(STALE_DECISION);

    const rankedHits = await provider.recall(recallQuery, { topK: 8 });
    const selection = selectEvidence(rankedHits);
    expect(selection.currentEvidenceIds).toEqual(
      expect.arrayContaining([
        stores.currentRenderMemoryId,
        stores.currentAuditKnowledgeId,
      ]),
    );
    expect(selection.ignoredStaleEvidenceIds).toEqual(
      expect.arrayContaining([
        stores.staleMemoryId,
        stores.staleKnowledgeId,
        stores.staleTaskId,
      ]),
    );

    const promptOnlyDiff = applyRecallBackedPatch(project.projectDir, "");
    const promptOnlyPredicate = evaluateInterferencePredicate({
      expectedRenderId: stores.currentRenderMemoryId,
      expectedAuditId: stores.currentAuditKnowledgeId,
      selection: { currentEvidenceIds: [], ignoredStaleEvidenceIds: [] },
      finalDiff: promptOnlyDiff,
    });
    expect(promptOnlyPredicate.passed).toBe(false);

    writeInitialSourceFile(project.projectDir);
    const staleOnlyDiff = applyRecallBackedPatch(project.projectDir, STALE_DECISION);
    const staleOnlyPredicate = evaluateInterferencePredicate({
      expectedRenderId: stores.currentRenderMemoryId,
      expectedAuditId: stores.currentAuditKnowledgeId,
      selection: {
        currentEvidenceIds: [],
        ignoredStaleEvidenceIds: [
          stores.staleMemoryId,
          stores.staleKnowledgeId,
          stores.staleTaskId,
        ],
      },
      finalDiff: staleOnlyDiff,
    });
    expect(staleOnlyPredicate.passed).toBe(false);
    expect(staleOnlyDiff).toContain(STALE_DECISION);

    writeInitialSourceFile(project.projectDir);
    const finalDiff = applyRecallBackedPatch(
      project.projectDir,
      toolResult.content,
    );
    const predicateResult = evaluateInterferencePredicate({
      expectedRenderId: stores.currentRenderMemoryId,
      expectedAuditId: stores.currentAuditKnowledgeId,
      selection,
      finalDiff,
    });
    expect(predicateResult.passed).toBe(true);

    const artifact = {
      provenance: FIXTURE_PROVENANCE,
      fixtureNotes: FIXTURE_NOTES,
      laterPrompt,
      recallQuery,
      seededRecords: {
        current: [
          {
            source: "memory",
            id: stores.currentRenderMemoryId,
            marker: CURRENT_RENDER_DECISION,
          },
          {
            source: "knowledge",
            id: stores.currentAuditKnowledgeId,
            marker: CURRENT_AUDIT_DECISION,
          },
        ],
        stale: [
          { source: "memory", id: stores.staleMemoryId, marker: STALE_DECISION },
          { source: "knowledge", id: stores.staleKnowledgeId, marker: STALE_DECISION },
          { source: "tasks", id: stores.staleTaskId, marker: STALE_DECISION },
        ],
        distractors: [
          { source: "history", id: stores.historyDistractorId },
        ],
      },
      rankedHits: rankedHits.map((hit) => ({
        source: hit.source,
        id: hit.id,
        score: hit.score,
        text: hitText(hit),
      })),
      selectedCurrentEvidenceIds: selection.currentEvidenceIds,
      ignoredStaleEvidenceIds: selection.ignoredStaleEvidenceIds,
      toolOutput: toolResult.content,
      promptOnlyProbe: {
        finalDiff: promptOnlyDiff,
        predicateResult: promptOnlyPredicate,
      },
      staleOnlyProbe: {
        finalDiff: staleOnlyDiff,
        predicateResult: staleOnlyPredicate,
      },
      finalDiff,
      predicateResult,
    };
    const artifactPath = writeVerificationArtifact({
      projectDir: project.projectDir,
      artifact,
    });

    const written = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      provenance?: { sources?: string[] };
      selectedCurrentEvidenceIds?: string[];
      ignoredStaleEvidenceIds?: string[];
      predicateResult?: PredicateResult;
      promptOnlyProbe?: { predicateResult?: PredicateResult };
      staleOnlyProbe?: { predicateResult?: PredicateResult };
    };
    expect(written.provenance?.sources).toEqual(FIXTURE_PROVENANCE.sources);
    expect(written.selectedCurrentEvidenceIds).toEqual(
      expect.arrayContaining([
        stores.currentRenderMemoryId,
        stores.currentAuditKnowledgeId,
      ]),
    );
    expect(written.ignoredStaleEvidenceIds).toEqual(
      expect.arrayContaining([
        stores.staleMemoryId,
        stores.staleKnowledgeId,
        stores.staleTaskId,
      ]),
    );
    expect(written.promptOnlyProbe?.predicateResult).toMatchObject({
      passed: false,
    });
    expect(written.staleOnlyProbe?.predicateResult).toMatchObject({
      passed: false,
    });
    expect(written.predicateResult).toMatchObject({ passed: true });
  });
});
