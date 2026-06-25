import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetSecretStore } from "#core/config/secrets.js";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import { IMPORTED_SKILL_PROVENANCE_FILE } from "#core/modules/imported-skills.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import type { RecallFilter, RecallHit } from "#modules/recall/client.js";
import { RECALL_PROVIDER_TOKEN, type RecallProvider } from "#modules/recall/recall-types.js";
import { moduleSummary } from "./provider-test-support.js";
import { buildResourceDiscoverySnapshotReader, configuredMcpServers } from "./snapshot.js";

afterEach(() => {
  resetProviderRegistry();
  resetSecretStore();
  vi.restoreAllMocks();
});

describe("configuredMcpServers", () => {
  it("reads MCP config metadata without fetching, installing, executing, or exposing values", () => {
    const dir = mkdtempSync(join(tmpdir(), "resource-discovery-mcp-"));
    mkdirSync(join(dir, ".kota"), { recursive: true });
    writeFileSync(
      join(dir, ".kota", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          privatePayments: {
            type: "http",
            url: "https://private.example/mcp?token=secret-token",
            headers: { Authorization: "Bearer secret-token" },
          },
          npmServer: {
            command: "npx",
            args: ["dangerous-package"],
            env: { SECRET: "hidden" },
          },
        },
      }),
      "utf-8",
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const servers = configuredMcpServers(dir);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(servers).toEqual([
      {
        name: "privatePayments",
        transport: "http",
        configPath: ".kota/mcp.json#mcpServers.privatePayments",
        fields: ["headers", "type", "url"],
      },
      {
        name: "npmServer",
        transport: "stdio",
        configPath: ".kota/mcp.json#mcpServers.npmServer",
        fields: ["args", "command", "env"],
      },
    ]);
    const serialized = JSON.stringify(servers);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("dangerous-package");
    fetchSpy.mockRestore();
  });
});

describe("buildResourceDiscoverySnapshotReader", () => {
  it("does not invoke live capability readiness probes while building advisory snapshots", async () => {
    resetProviderRegistry();
    resetSecretStore();
    const dir = mkdtempSync(join(tmpdir(), "resource-discovery-readiness-"));
    const registry = initProviderRegistry();
    const probe = vi.fn(async () => [{
      id: "google-workspace.oauth",
      moduleName: "google-workspace",
      status: "ready" as const,
    }]);
    registry.register(CAPABILITY_READINESS_PROVIDER_TYPE, "google-workspace", {
      moduleName: "google-workspace",
      probe,
    });

    const secretName = `KOTA_RESOURCE_DISCOVERY_TEST_SECRET_${Date.now()}`;
    const setupRequirement: ModuleSetupRequirement = {
      id: "socket-mode-credentials",
      kind: "secret",
      title: "Slack Socket Mode credentials",
      description: "Slack Socket Mode token references.",
      required: true,
      scope: "project",
      owner: "slack-channel",
      sensitivity: "secret",
      setup: {
        mode: "url",
        url: "https://api.slack.com/apps",
        label: "Open Slack app credentials",
      },
      secretRefs: [{ name: secretName, scope: "project" }],
    };
    const baseSummary = moduleSummary();
    const manifest = baseSummary.manifest;
    if (!manifest) throw new Error("expected test manifest");
    const summary = moduleSummary({
      setupRequirements: [setupRequirement],
      manifest: {
        ...manifest,
        contributions: {
          ...manifest.contributions,
          setupRequirements: manifest.contributions.setupRequirements.map((req) => ({
            id: req.id,
            kind: req.kind,
            setupMode: req.setupMode,
            sensitivity: req.sensitivity,
            required: req.required,
            healthCapabilityIds: req.healthCapabilityIds,
            statusLinks: req.statusLinks,
          })),
        },
      },
    });
    const ctx = {
      cwd: dir,
      getModuleSummaries: () => [summary],
      getProvider<T>(_token: typeof RECALL_PROVIDER_TOKEN): T | null {
        return null;
      },
    } as unknown as ModuleContext;

    const snapshot = await buildResourceDiscoverySnapshotReader(ctx)(
      "slack credentials",
      {},
    );

    expect(probe).not.toHaveBeenCalled();
    expect(
      snapshot.summaries[0]?.manifest?.contributions.setupRequirements[0]
        ?.availability,
    ).toMatchObject({
      state: "missing",
    });
  });

  it("reads recall hits and imported skill metadata through existing provider surfaces", async () => {
    const dir = mkdtempSync(join(tmpdir(), "resource-discovery-snapshot-"));
    const skillDir = join(dir, ".kota", "skills", "imported-review");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: imported-review\ndescription: Review TypeScript changes\n---\nUse careful review.\n",
      "utf-8",
    );
    writeFileSync(
      join(skillDir, IMPORTED_SKILL_PROVENANCE_FILE),
      `${JSON.stringify({
        version: 1,
        skillName: "imported-review",
        source: "/skills/imported-review",
        sourceKind: "skill-directory",
        selectedSkillPath: "/skills/imported-review/SKILL.md",
        provenance: "/skills/imported-review",
        importedFiles: ["SKILL.md"],
        skippedFiles: [],
      }, null, 2)}\n`,
      "utf-8",
    );

    const recallHit: RecallHit = {
      source: "memory",
      score: 1,
      id: "mem-1",
      preview: "Deployment checklist memory",
      created: "2026-06-24T00:00:00.000Z",
    };
    const captured: { query?: string; filter?: RecallFilter } = {};
    const recallProvider: RecallProvider = {
      register() {},
      unregister() {},
      contributors: () => ["memory"],
      recall: async (query, filter) => {
        captured.query = query;
        captured.filter = filter;
        return [recallHit];
      },
    };
    const registry = initProviderRegistry();
    registry.register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "test", {
      getProjectRegistryProjection: () => ({
        defaultProjectId: "project-a",
        projects: [{
          projectId: "project-a",
          projectDir: dir,
          displayName: "Project A",
        }],
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
      cwd: dir,
      getModuleSummaries: () => [],
      getProvider<T>(token: typeof RECALL_PROVIDER_TOKEN): T | null {
        return token === RECALL_PROVIDER_TOKEN ? (recallProvider as T) : null;
      },
    } as unknown as ModuleContext;

    const snapshot = await buildResourceDiscoverySnapshotReader(ctx)(
      "deployment checklist",
      { scopeId: "project-a" },
    );

    expect(captured).toEqual({
      query: "deployment checklist",
      filter: {
        topK: 20,
        sources: ["memory", "history", "tasks", "answer"],
        scopeId: "project-a",
      },
    });
    expect(snapshot.recallHits).toEqual([recallHit]);
    expect(snapshot.skillSummaries).toContainEqual(
      expect.objectContaining({
        name: "imported-review",
        source: "imported",
        sourceType: "imported",
        activation: "explicit",
        promptPath: ".kota/skills/imported-review/SKILL.md",
      }),
    );
  });
});
