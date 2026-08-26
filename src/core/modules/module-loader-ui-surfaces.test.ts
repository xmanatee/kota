import { describe, expect, it, vi } from "vitest";
import type { UiSurface } from "#core/daemon/ui-surface.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { createRuntimeModuleLoader } from "./module-context.test-helpers.js";

function uiProjectionClient(): KotaClient {
  const client = {
    scopes: {
      list: async () => ({
        ok: true as const,
        scopes: [],
        defaultScopeId: "scope-a",
        activeScopeId: null,
      }),
    },
  } as unknown as KotaClient;
  client.forScope = () => client;
  return client;
}

function demoSurface() {
  return {
    protocolVersion: "ui.surface.v1" as const,
    surfaceId: "demo",
    extensionId: "demo.surface",
    title: "Demo",
    intent: "Work" as const,
    scopeId: "scope-a",
    attachmentPoint: { kind: "root" as const },
    order: 10,
    nodes: [],
    actions: [],
  };
}

describe("ModuleLoader live UI surfaces", () => {
  it("projects live sources and validates global extension ids", async () => {
    const loader = createRuntimeModuleLoader({});
    const surface = demoSurface();
    await loader.load({
      name: "ui-provider",
      uiSurfaces: [{ sourceId: "demo", scope: () => [surface] }],
    });

    await expect(loader.assembleUiSurfaceBundle({ client: uiProjectionClient() }))
      .resolves.toEqual({ protocolVersion: "ui.surface.v1", surfaces: [surface] });
    await loader.load({
      name: "bad-ui-provider",
      uiSurfaces: [{
        sourceId: "other-demo",
        scope: () => [{ ...surface, surfaceId: "other-demo" }],
      }],
    });
    await expect(loader.assembleUiSurfaceBundle({ client: uiProjectionClient() }))
      .rejects.toThrow(/duplicate extensionId "demo.surface"/);
  });

  it("rejects invalid runtime discriminants", async () => {
    const loader = createRuntimeModuleLoader({});
    const surface = {
      ...demoSurface(),
      nodes: [{ kind: "timeline" } as unknown as UiSurface["nodes"][number]],
    };
    await loader.load({
      name: "bad-ui-provider",
      uiSurfaces: [{ sourceId: "bad-demo", scope: () => [surface] }],
    });
    await expect(loader.assembleUiSurfaceBundle({ client: uiProjectionClient() }))
      .rejects.toThrow(/node timeline\.kind "timeline" must be one of/);
  });

  it("rejects duplicate source ids at registration", async () => {
    const loader = createRuntimeModuleLoader({});
    await loader.load({
      name: "first-ui-provider",
      uiSurfaces: [{ sourceId: "status", scope: () => [] }],
    });
    await expect(loader.load({
      name: "second-ui-provider",
      uiSurfaces: [{ sourceId: "status", scope: () => [] }],
    })).rejects.toThrow(
      /Duplicate UI surface source id "status" from modules "first-ui-provider" and "second-ui-provider"/,
    );
  });

  it("reloads source definitions and applies explicit scope selection", async () => {
    const loader = createRuntimeModuleLoader({});
    let title = "Before reload";
    await loader.load({
      name: "live-ui-provider",
      uiSurfaces: () => {
        const capturedTitle = title;
        return [{
          sourceId: "live",
          scope: ({ scopeId }) => [{
            ...demoSurface(),
            surfaceId: "live",
            extensionId: "live.surface",
            title: `${capturedTitle}: ${scopeId}`,
            scopeId,
          }],
        }];
      },
    });

    title = "After reload";
    const before = await loader.assembleUiSurfaceBundle({
      client: uiProjectionClient(),
      selector: { scopeId: "scope-b" },
    });
    expect(before.surfaces[0]?.title).toBe("Before reload: scope-b");

    await expect(loader.reload("live-ui-provider")).resolves.toBe(true);
    const after = await loader.assembleUiSurfaceBundle({
      client: uiProjectionClient(),
      selector: { scopeId: "scope-c" },
    });
    expect(after.surfaces[0]?.title).toBe("After reload: scope-c");
  });

  it.each([
    { label: "active", activeScopeId: "scope-active", expectedScopeId: "scope-active" },
    { label: "default", activeScopeId: null, expectedScopeId: "scope-default" },
  ])("scopes contributor reads to the implicit $label scope", async ({
    activeScopeId,
    expectedScopeId,
  }) => {
    const loader = createRuntimeModuleLoader({});
    const baseMemoryList = vi.fn(async () => ({ entries: [{ content: "base" }] }));
    const scopedMemoryList = vi.fn(async () => ({ entries: [{ content: "scoped" }] }));
    const scopedClient = {
      memory: { list: scopedMemoryList },
    } as unknown as KotaClient;
    const forScope = vi.fn(() => scopedClient);
    const client = {
      scopes: {
        list: async () => ({
          ok: true as const,
          scopes: [],
          defaultScopeId: "scope-default",
          activeScopeId,
        }),
      },
      memory: { list: baseMemoryList },
      forScope,
    } as unknown as KotaClient;
    await loader.load({
      name: "scoped-ui-provider",
      uiSurfaces: [{
        sourceId: "scoped",
        scope: async (context) => {
          const memory = await context.client.memory.list();
          return [{
            ...demoSurface(),
            title: `${context.scopeId}:${memory.entries[0]?.content}`,
            scopeId: context.scopeId,
          }];
        },
      }],
    });

    const bundle = await loader.assembleUiSurfaceBundle({ client });

    expect(bundle.surfaces[0]?.title).toBe(`${expectedScopeId}:scoped`);
    expect(forScope).toHaveBeenCalledOnce();
    expect(forScope).toHaveBeenCalledWith(expectedScopeId);
    expect(scopedMemoryList).toHaveBeenCalledOnce();
    expect(baseMemoryList).not.toHaveBeenCalled();
  });

  it("wraps contributor failures with typed source ownership", async () => {
    const loader = createRuntimeModuleLoader({});
    await loader.load({
      name: "failing-ui-provider",
      uiSurfaces: [{
        sourceId: "failing",
        scope: () => {
          throw new Error("backend unavailable");
        },
      }],
    });

    await expect(loader.assembleUiSurfaceBundle({ client: uiProjectionClient() }))
      .rejects.toMatchObject({
        name: "UiSurfaceSourceError",
        moduleName: "failing-ui-provider",
        sourceId: "failing",
      });
  });
});
