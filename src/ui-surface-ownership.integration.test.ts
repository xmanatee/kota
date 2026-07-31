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
import daemonOpsModule from "#modules/daemon-ops/index.js";
import { findUiAction } from "#modules/daemon-ops/operator-ui.js";
import historyModule from "#modules/history/index.js";
import knowledgeModule from "#modules/knowledge/index.js";
import memoryModule from "#modules/memory/index.js";
import moduleManagerModule from "#modules/module-manager/index.js";
import setupModule from "#modules/setup/index.js";
import workflowOpsModule from "#modules/workflow-ops/index.js";

const OWNERS = [
  [daemonOpsModule, ["status", "scopes", "inbox", "continuity", "operator-control"]],
  [workflowOpsModule, ["runs"]],
  [moduleManagerModule, ["modules-agents"]],
  [setupModule, ["setup"]],
  [memoryModule, ["stores"]],
  [knowledgeModule, ["knowledge-store"]],
  [historyModule, ["history-store"]],
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
  client.forProject = () => client;
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
    const projectDir = mkdtempSync(join(tmpdir(), "kota-ui-owners-"));
    try {
      const registrations: RegisteredUiSurfaceSource[] = OWNERS.flatMap(([mod]) =>
        staticUiSources(mod).map((source) => ({ moduleName: mod.name, source }))
      );
      const bundle = await assembleUiSurfaceBundle(projectDir, registrations, {
        client: projectionClient(),
        selector: { scopeId: "scope-test" },
      });

      expect(bundle.surfaces.map((surface) => surface.surfaceId)).toEqual([
        "status",
        "scopes",
        "inbox",
        "continuity",
        "operator-control",
        "runs",
        "modules-agents",
        "setup",
        "stores",
        "knowledge-store",
        "history-store",
      ]);
      expect(bundle.surfaces.every((surface) => surface.scopeId === "scope-test")).toBe(true);
      expect(findUiAction(bundle, "runs", "workflow.status")).toMatchObject({
        surfaceId: "runs",
        actionId: "workflow.status",
        scopeId: "scope-test",
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
