import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import setupModule from "./index.js";

function setupSummary() {
  const setupRequirement = {
    id: "endpoint",
    kind: "config" as const,
    title: "Endpoint",
    required: true,
    scope: "project" as const,
    sensitivity: "none" as const,
    setup: {
      mode: "form" as const,
      fields: [{
        id: "base-url",
        label: "Base URL",
        type: "string" as const,
        configPath: "modules.demo.baseUrl",
        required: true,
      }],
    },
  };
  return {
    name: "demo",
    source: "project" as const,
    dependencies: [],
    toolNames: [],
    workflowNames: [],
    channelNames: [],
    skillNames: [],
    agentNames: [],
    agents: [],
    skills: [],
    commandNames: [],
    routeSummaries: [],
    setupRequirements: [setupRequirement],
    manifest: {
      schemaVersion: 1 as const,
      moduleName: "demo",
      dependencies: [],
      capabilities: [{
        id: "demo.api",
        description: "Demo API.",
        scope: "external" as const,
        scopePolicyHooks: ["setup"],
        setupRequirementIds: ["endpoint"],
      }],
      dataClasses: [],
      contributions: {
        tools: [],
        workflows: [],
        workflowTriggers: [],
        channels: [],
        skills: [],
        agents: [],
        commands: [],
        routes: [],
        controlRoutes: [],
        events: [],
        eventFlows: [],
        clients: { localNamespaces: [], daemonFactory: false },
        setupRequirements: [{
          id: "endpoint",
          kind: "config" as const,
          setupMode: "form" as const,
          sensitivity: "none" as const,
          required: true,
          healthCapabilityIds: [],
          statusLinks: {
            list: "/setup/requirements",
            refresh: "/setup/requirements/demo/endpoint/refresh",
            revoke: "/setup/requirements/demo/endpoint",
            submitForm: "/setup/requirements/demo/endpoint/form",
          },
        }],
      },
      effects: [],
      simulation: { support: "full" as const, blockedReasons: [] },
      readiness: {
        setupRequirementIds: ["endpoint"],
        healthCapabilityIds: [],
        healthCheck: "not-declared" as const,
      },
    },
  };
}

describe("setup client scope", () => {
  it("reads and mutates setup state in the selected directory scope", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "kota-setup-base-"));
    const scopedDir = mkdtempSync(join(tmpdir(), "kota-setup-scoped-"));
    const operatorDir = mkdtempSync(join(tmpdir(), "kota-setup-authority-"));
    const authorityConfigPath = join(operatorDir, "config.json");
    writeFileSync(authorityConfigPath, JSON.stringify({ trustedProjects: [scopedDir] }));
    try {
      const provider = {
        resolveProjectRuntime: (scopeId: string) => scopeId === "scope-b"
          ? {
              ok: true as const,
              runtime: {
                authorityConfigPath,
                project: {
                  projectId: "scope-b",
                  projectDir: scopedDir,
                  displayName: "Scoped",
                },
              },
            }
          : { ok: false as const, error: { error: "Unknown scope" } },
      };
      const handlers = setupModule.localClient!({
        cwd: baseDir,
        getModuleSummaries: () => [setupSummary()],
        getProvider: (_token: typeof DAEMON_PROJECT_SCOPE_PROVIDER_TYPE) => provider,
      } as unknown as ModuleContext);
      const client = handlers.setup!;

      await expect(client.submitForm(
        "demo",
        "endpoint",
        { "base-url": "https://scoped.example.test" },
        { scopeId: "scope-b" },
      )).resolves.toMatchObject({ ok: true });
      await expect(client.list()).resolves.toMatchObject({
        requirements: [expect.objectContaining({ state: "missing" })],
      });
      await expect(client.list({ scopeId: "scope-b" })).resolves.toMatchObject({
        requirements: [expect.objectContaining({ state: "ready" })],
      });
      await expect(async () => client.list({ scopeId: "missing" })).rejects.toThrow(
        "Unknown scope: missing",
      );
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
      rmSync(scopedDir, { recursive: true, force: true });
      rmSync(operatorDir, { recursive: true, force: true });
    }
  });

  it("keeps unscoped daemon setup calls compatible and rejects scoped ones", async () => {
    const requestStrict = vi.fn(async () => ({
      requirements: [],
      summary: {
        ready: 0,
        missing: 0,
        pending: 0,
        expired: 0,
        revoked: 0,
        unknown: 0,
        unavailable: 0,
      },
    }));
    const transport = {
      requestStrict,
    } as unknown as DaemonTransport;
    const client = setupModule.daemonClient!(transport).setup!;

    await client.list();
    await expect(client.list({ scopeId: "scope-b" })).rejects.toThrow(
      "Scoped setup operation for scope-b must execute through KotaClient.ui.",
    );
    expect(requestStrict).toHaveBeenCalledOnce();
    expect(requestStrict).toHaveBeenCalledWith("GET", "/setup/requirements");
  });
});
