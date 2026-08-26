import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { KotaModule } from "#core/modules/module-types.js";
import {
  assembleUiSurfaceBundle,
  type RegisteredUiSurfaceSource,
  type UiSurfaceSource,
} from "#core/modules/module-ui-surfaces.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { KotaClient } from "#core/server/kota-client.js";
import answerModule from "#modules/answer/index.js";
import approvalQueueModule from "#modules/approval-queue/index.js";
import autonomyModule from "#modules/autonomy/index.js";
import captureModule from "#modules/capture/index.js";
import configModule from "#modules/config/index.js";
import daemonOpsModule from "#modules/daemon-ops/index.js";
import { findUiAction } from "#modules/daemon-ops/operator-ui.js";
import guardrailsAuditModule from "#modules/guardrails-audit/index.js";
import historyModule from "#modules/history/index.js";
import knowledgeModule from "#modules/knowledge/index.js";
import memoryModule from "#modules/memory/index.js";
import moduleManagerModule from "#modules/module-manager/index.js";
import ownerQuestionsModule from "#modules/owner-questions/index.js";
import recallModule from "#modules/recall/index.js";
import repoTasksModule from "#modules/repo-tasks/index.js";
import retractModule from "#modules/retract/index.js";
import setupModule from "#modules/setup/index.js";
import workflowOpsModule from "#modules/workflow-ops/index.js";

const OWNERS = [
  [daemonOpsModule, ["status", "scopes", "inbox", "continuity"]],
  [approvalQueueModule, ["approvals"]],
  [ownerQuestionsModule, ["owner-questions"]],
  [workflowOpsModule, ["runs"]],
  [repoTasksModule, ["tasks"]],
  [moduleManagerModule, ["modules-agents"]],
  [setupModule, ["setup"]],
  [memoryModule, ["stores"]],
  [knowledgeModule, ["knowledge-store"]],
  [historyModule, ["history-store"]],
  [recallModule, ["recall"]],
  [answerModule, ["answers"]],
  [captureModule, ["capture"]],
  [retractModule, ["retract"]],
  [configModule, ["configuration"]],
  [guardrailsAuditModule, ["guardrail-audit"]],
  [autonomyModule, ["daily-digest"]],
] as const satisfies readonly (readonly [KotaModule, readonly string[]])[];

function staticUiSources(mod: KotaModule): readonly UiSurfaceSource[] {
  if (!mod.uiSurfaces || typeof mod.uiSurfaces === "function") {
    throw new Error(`Module ${mod.name} must declare side-effect-free UI source definitions`);
  }
  return mod.uiSurfaces;
}

function projectionClient(): KotaClient {
  const handlers = buildMigratedNamespaceTestStubs();
  const client = {
    ...handlers,
  } as unknown as KotaClient;
  client.forScope = () => client;
  return client;
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    const isTypeScript = entry.name.endsWith(".ts") || entry.name.endsWith(".tsx");
    const isTest = entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx");
    return entry.isFile() && isTypeScript && !isTest
      ? [path]
      : [];
  });
}

describe("module-owned UI surface assembly", () => {
  it("keeps raw bundle assembly inside the canonical core boundary", () => {
    const sourceDir = join(process.cwd(), "src");
    const directAssemblers = productionTypeScriptFiles(sourceDir)
      .filter((path) => readFileSync(path, "utf8").includes("buildUiSurfaceBundle"))
      .map((path) => relative(process.cwd(), path))
      .sort();

    expect(directAssemblers).toEqual([
      "src/core/daemon/ui-surface.ts",
      "src/core/modules/module-ui-surfaces.ts",
    ]);
  });

  it("keeps each live source declaration with its capability owner", () => {
    expect(OWNERS.map(([mod, expected]) => ({
      module: mod.name,
      sources: staticUiSources(mod).map((source) => source.sourceId),
      expected,
    }))).toEqual(OWNERS.map(([mod, expected]) => ({
      module: mod.name,
      sources: expected,
      expected,
    })));
  });

  it("projects every owner through one validated bundle and resolves actions from it", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-ui-owners-"));
    try {
      const registrations: RegisteredUiSurfaceSource[] = OWNERS.flatMap(([mod]) =>
        staticUiSources(mod).map((source) => ({ moduleName: mod.name, source }))
      );
      const bundle = await assembleUiSurfaceBundle(scopeRoot, registrations, {
        client: projectionClient(),
        selector: { scopeId: "scope-test" },
      });

      expect(bundle.surfaces.map((surface) => surface.surfaceId)).toEqual([
        "status",
        "scopes",
        "inbox",
        "approvals",
        "continuity",
        "owner-questions",
        "runs",
        "tasks",
        "modules-agents",
        "setup",
        "configuration",
        "guardrail-audit",
        "stores",
        "knowledge-store",
        "history-store",
        "recall",
        "answers",
        "capture",
        "retract",
        "daily-digest",
      ]);
      expect(bundle.surfaces.every((surface) => surface.scopeId === "scope-test")).toBe(true);
      expect(findUiAction(bundle, "runs", "workflow.status")).toMatchObject({
        surfaceId: "runs",
        actionId: "workflow.status",
        scopeId: "scope-test",
      });
      expect(findUiAction(bundle, "runs", "run.compare")).toBeTruthy();
      expect(findUiAction(bundle, "approvals", "approvals.list")).toBeTruthy();
      expect(findUiAction(bundle, "owner-questions", "owner-questions.list")).toBeTruthy();
      expect(findUiAction(bundle, "tasks", "task.body.update")).toBeTruthy();
      expect(findUiAction(bundle, "knowledge-store", "knowledge.search")).toBeTruthy();
      expect(findUiAction(bundle, "history-store", "history.show")).toBeTruthy();
      expect(findUiAction(bundle, "recall", "recall.query")).toBeTruthy();
      expect(findUiAction(bundle, "answers", "answer.query")).toBeTruthy();
      expect(findUiAction(bundle, "capture", "capture.create")).toBeTruthy();
      expect(findUiAction(bundle, "retract", "retract.remove")).toBeTruthy();
      expect(findUiAction(bundle, "configuration", "config.get")).toBeTruthy();
      expect(findUiAction(bundle, "guardrail-audit", "audit.list")).toBeTruthy();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});
