import { describe, expect, it, vi } from "vitest";
import { ScopeOnboardingInspectionError } from "#core/daemon/scope-onboarding.js";
import type { DaemonScopeProvider } from "#core/daemon/scope-provider.js";
import { scopesLocalClient } from "./scopes-local.js";

describe("daemon-local scopes client", () => {
  it("uses the daemon scope operator provider for shared UI lifecycle actions", async () => {
    const inspection = { operationId: "operation-1", directoryRoot: "/external" } as never;
    const plan = { operationId: "operation-1", scopeId: "scope-external" } as never;
    const operation = { operationId: "operation-1", state: "succeeded" } as never;
    const operator: NonNullable<DaemonScopeProvider["operator"]> = {
      inspectOnboarding: vi.fn(async () => inspection),
      planOnboarding: vi.fn(async () => ({ ok: true as const, plan })),
      applyOnboarding: vi.fn(async () => ({ ok: true as const, operation })),
      getOnboardingStatus: vi.fn(async () => operation),
      retryOnboarding: vi.fn(async () => ({ ok: true as const, operation })),
      cancelOnboarding: vi.fn(async () => ({ ok: true as const, operation })),
      drain: vi.fn(async (scopeId: string) => ({
        ok: true as const,
        status: "drained" as const,
        scope: { scopeId, directoryRoot: "/external", displayName: "External" },
      })),
      remove: vi.fn(async (scopeId: string) => ({
        ok: true as const,
        status: "removed" as const,
        scope: { scopeId, directoryRoot: "/external", displayName: "External" },
      })),
    };
    const setActiveScopeId = vi.fn((scopeId: string | null) => ({
      ok: true as const,
      activeScopeId: scopeId,
    }));
    const provider = {
      getScopeRegistryProjection: () => ({
        rootScopeId: "root",
        defaultScopeId: "scope-current",
        scopes: [{
          scopeId: "scope-current",
          displayName: "Current",
          directoryRoot: "/current",
        }],
      }),
      getActiveScopeId: () => "scope-current",
      setActiveScopeId,
      operator,
    } as DaemonScopeProvider;
    const client = scopesLocalClient({
      getProvider: () => provider,
    } as never);

    await expect(client.list()).resolves.toEqual({
      ok: true,
      scopes: [{
        scopeId: "scope-current",
        displayName: "Current",
        scopeRoot: "/current",
      }],
      defaultScopeId: "scope-current",
      activeScopeId: "scope-current",
    });
    await expect(client.use("scope-current")).resolves.toEqual({
      ok: true,
      activeScopeId: "scope-current",
    });
    await expect(client.inspectOnboarding("/external")).resolves.toEqual({
      ok: true,
      inspection,
    });
    await expect(client.applyOnboarding(plan, "confirm-dangerous")).resolves.toEqual({
      ok: true,
      operation,
    });
    await expect(client.drain("scope-external")).resolves.toMatchObject({
      ok: true,
      status: "drained",
    });
    await expect(client.remove("scope-external")).resolves.toMatchObject({
      ok: true,
      status: "removed",
    });
    expect(operator.applyOnboarding).toHaveBeenCalledWith(plan, "confirm-dangerous");
    expect(setActiveScopeId).toHaveBeenCalledWith("scope-current");
  });

  it("keeps offline local clients explicit", async () => {
    const client = scopesLocalClient();
    await expect(client.list()).resolves.toEqual({
      ok: false,
      reason: "daemon_required",
    });
    await expect(client.use(null)).resolves.toEqual({
      ok: false,
      reason: "daemon_required",
    });
    await expect(client.inspectOnboarding("/external")).resolves.toEqual({
      ok: false,
      reason: "daemon_required",
    });
    await expect(client.remove("scope-external")).resolves.toEqual({
      ok: false,
      reason: "daemon_required",
    });
  });

  it("normalizes invalid local inspection paths like the daemon route", async () => {
    const client = scopesLocalClient({
      getProvider: () => ({
        operator: {
          inspectOnboarding: vi.fn(async () => {
            throw new ScopeOnboardingInspectionError(
              "directory_not_found",
              "Scope root does not exist: /missing",
            );
          }),
        },
      }) as unknown as DaemonScopeProvider,
    } as never);

    await expect(client.inspectOnboarding("/missing")).resolves.toEqual({
      ok: false,
      reason: "invalid_directory",
      message: "Scope root does not exist: /missing",
    });
  });
});
