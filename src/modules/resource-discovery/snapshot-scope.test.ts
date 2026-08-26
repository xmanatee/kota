import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetSecretStores } from "#core/config/secrets.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
  buildDirectoryScope,
  buildScopeRegistryProjection,
} from "#core/daemon/scope-registry.js";
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
  resetSecretStores();
});

describe("resource discovery scoped snapshot sources", () => {
  it("scopes scope-specific knowledge, setup availability, and MCP metadata to the selected scope", async () => {
    const defaultDir = mkdtempSync(join(tmpdir(), "resource-discovery-default-"));
    const scopeBRoot = mkdtempSync(join(tmpdir(), "resource-discovery-scope-b-"));
    const globalKnowledgeDir = mkdtempSync(join(tmpdir(), "resource-discovery-global-"));
    const defaultScope = buildDirectoryScope({
      scopeRoot: defaultDir,
      displayName: "Default",
    });
    const scopeB = buildDirectoryScope({
      scopeRoot: scopeBRoot,
      displayName: "Scope B",
    });
    const marker = "resource-discovery-scope-marker";
    const defaultStore = new KnowledgeStore(defaultDir, globalKnowledgeDir);
    const scopeBStore = new KnowledgeStore(scopeBRoot, globalKnowledgeDir);
    defaultStore.create({
      title: `Default ${marker}`,
      content: `Default scope ${marker}`,
    });
    scopeBStore.create({
      title: `Scope B ${marker}`,
      content: `Selected scope ${marker}`,
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
    mkdirSync(join(scopeBRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeBRoot, ".kota", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          projectBOnly: { type: "http", url: "https://scope-b.example/mcp" },
        },
      }),
      "utf-8",
    );

    const setupRequirement = scopeConfigRequirement();
    const scopedSummary = moduleSummary({
      name: "scope-regression-probe",
      toolNames: [],
      setupRequirements: [setupRequirement],
      manifest: scopeProbeManifest(setupRequirement),
    });
    const registry = initProviderRegistry();
    registry.register(KNOWLEDGE_PROVIDER_TOKEN, "knowledge", defaultStore);
    registry.register(DAEMON_SCOPE_PROVIDER_TYPE, "test", {
      getScopeRegistryProjection: () =>
        buildScopeRegistryProjection(defaultScope.scopeId, [defaultScope, scopeB]),
      getActiveScopeId: () => null,
      resolveScopeRuntime: (scopeId) => ({
        ok: false,
        error: {
          error: "Unknown scope",
          reason: "unknown_scope",
          scopeId: scopeId ?? "",
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

    const snapshot = await readSnapshot(marker, { scopeId: scopeB.scopeId });

    expect(snapshot.knowledgeEntries.map((entry) => entry.title)).toEqual([
      `Scope B ${marker}`,
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

    const unresolved = await readSnapshot(marker, { scopeId: "missing-scope" });
    expect(unresolved.knowledgeEntries).toEqual([]);
    expect(unresolved.mcpServers).toEqual([]);
    expect(
      unresolved.summaries[0]?.manifest?.contributions.setupRequirements[0]
        ?.availability,
    ).toBeUndefined();
  });
});

function scopeConfigRequirement(): ModuleSetupRequirement {
  return {
    id: "scope-config",
    kind: "config",
    title: "Scope config flag",
    required: true,
    scope: "scope",
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
              "/setup/requirements/scope-regression-probe/scope-config/refresh",
            revoke: "/setup/requirements/scope-regression-probe/scope-config",
            submitForm:
              "/setup/requirements/scope-regression-probe/scope-config/form",
          },
        },
      ],
    },
  };
}
