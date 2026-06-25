import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetSecretStore } from "#core/config/secrets.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import { buildConfiguredProject } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  initProviderRegistry,
  KNOWLEDGE_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import type { RECALL_PROVIDER_TOKEN } from "#modules/recall/recall-types.js";
import { moduleSummary } from "./provider-test-support.js";
import { buildResourceDiscoverySnapshotReader } from "./snapshot.js";

afterEach(() => {
  resetProviderRegistry();
  resetSecretStore();
});

describe("resource discovery scoped snapshot sources", () => {
  it("scopes project-specific knowledge, setup availability, and MCP metadata to the selected project", async () => {
    const defaultDir = mkdtempSync(join(tmpdir(), "resource-discovery-default-"));
    const projectBDir = mkdtempSync(join(tmpdir(), "resource-discovery-project-b-"));
    const globalKnowledgeDir = mkdtempSync(join(tmpdir(), "resource-discovery-global-"));
    const defaultProject = buildConfiguredProject({
      projectDir: defaultDir,
      displayName: "Default",
    });
    const projectB = buildConfiguredProject({
      projectDir: projectBDir,
      displayName: "Project B",
    });
    const marker = "resource-discovery-scope-marker";
    const defaultStore = new KnowledgeStore(defaultDir, globalKnowledgeDir);
    const projectBStore = new KnowledgeStore(projectBDir, globalKnowledgeDir);
    defaultStore.create({
      title: `Default ${marker}`,
      content: `Default project ${marker}`,
    });
    projectBStore.create({
      title: `Project B ${marker}`,
      content: `Selected project ${marker}`,
    });

    mkdirSync(join(defaultDir, ".kota"), { recursive: true });
    writeFileSync(
      join(defaultDir, ".kota", "config.json"),
      JSON.stringify({
        modules: { scopeRegressionProbe: { enabled: true } },
      }),
      "utf-8",
    );
    writeFileSync(
      join(defaultDir, ".kota", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          defaultOnly: { command: "default-server" },
        },
      }),
      "utf-8",
    );
    mkdirSync(join(projectBDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectBDir, ".kota", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          projectBOnly: { type: "http", url: "https://project-b.example/mcp" },
        },
      }),
      "utf-8",
    );

    const setupRequirement = projectConfigRequirement();
    const scopedSummary = moduleSummary({
      name: "scope-regression-probe",
      toolNames: [],
      setupRequirements: [setupRequirement],
      manifest: scopeProbeManifest(setupRequirement),
    });
    const registry = initProviderRegistry();
    registry.register(KNOWLEDGE_PROVIDER_TOKEN, "knowledge", defaultStore);
    registry.register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "test", {
      getProjectRegistryProjection: () => ({
        defaultProjectId: defaultProject.projectId,
        projects: [defaultProject, projectB],
      }),
      getActiveProjectId: () => null,
      resolveProjectRuntime: (projectId) => ({
        ok: false,
        error: {
          error: "Unknown project",
          reason: "unknown_project",
          projectId: projectId ?? "",
        },
      }),
    });
    const ctx = {
      cwd: defaultDir,
      getModuleSummaries: () => [scopedSummary],
      getProvider<T>(_token: typeof RECALL_PROVIDER_TOKEN): T | null {
        return null;
      },
    } as unknown as ModuleContext;
    const readSnapshot = buildResourceDiscoverySnapshotReader(ctx);

    const snapshot = await readSnapshot(marker, { projectId: projectB.projectId });

    expect(snapshot.knowledgeEntries.map((entry) => entry.title)).toEqual([
      `Project B ${marker}`,
    ]);
    expect(snapshot.mcpServers.map((server) => server.name)).toEqual([
      "projectBOnly",
    ]);
    expect(
      snapshot.summaries[0]?.manifest?.contributions.setupRequirements[0]
        ?.availability,
    ).toMatchObject({
      state: "missing",
      reason: "config_missing",
    });

    const unresolved = await readSnapshot(marker, { projectId: "missing-project" });
    expect(unresolved.knowledgeEntries).toEqual([]);
    expect(unresolved.mcpServers).toEqual([]);
    expect(
      unresolved.summaries[0]?.manifest?.contributions.setupRequirements[0]
        ?.availability,
    ).toBeUndefined();
  });
});

function projectConfigRequirement(): ModuleSetupRequirement {
  return {
    id: "project-config",
    kind: "config",
    title: "Project config flag",
    required: true,
    scope: "project",
    sensitivity: "none",
    setup: {
      mode: "form",
      fields: [
        {
          id: "enabled",
          label: "Enabled",
          type: "boolean",
          configPath: "modules.scopeRegressionProbe.enabled",
          required: true,
        },
      ],
    },
  };
}

function scopeProbeManifest(setupRequirement: ModuleSetupRequirement) {
  const manifest = moduleSummary().manifest;
  if (!manifest) throw new Error("expected test manifest");
  return {
    ...manifest,
    moduleName: "scope-regression-probe",
    contributions: {
      ...manifest.contributions,
      setupRequirements: [
        {
          id: setupRequirement.id,
          kind: setupRequirement.kind,
          setupMode: setupRequirement.setup.mode,
          sensitivity: setupRequirement.sensitivity,
          required: setupRequirement.required,
          healthCapabilityIds: [],
          statusLinks: {
            list: "/setup/requirements",
            refresh:
              "/setup/requirements/scope-regression-probe/project-config/refresh",
            revoke: "/setup/requirements/scope-regression-probe/project-config",
            submitForm:
              "/setup/requirements/scope-regression-probe/project-config/form",
          },
        },
      ],
    },
  };
}
