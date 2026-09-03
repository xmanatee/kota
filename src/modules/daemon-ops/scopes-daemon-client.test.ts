/**
 * Scopes namespace daemon-side handler test.
 *
 * Pins the wire shape `daemonClient(link)` produces for the `scopes`
 * namespace:
 *
 *  1. Module exposes a `scopes` handler with `list` and `use` methods.
 *  2. `list()` is a `GET /scopes` call with auth headers and decodes
 *     a 200 response into `{ ok: true, scopes, defaultScopeId,
 *     activeScopeId }`.
 *  3. `list()` surfaces transport failures.
 *  4. `use(id)` is a `PATCH /scopes/active` call with body
 *     `{ scopeId }` and decodes a 200 into `{ ok: true,
 *     activeScopeId }`.
 *  5. `use(null)` clears the selection through the same wire path.
 *  6. `use(id)` decodes a 404 into the typed `not_found` arm,
 *     preserving the daemon-supplied scopeId.
 *  7. `use(id)` surfaces transport failures.
 *  8. The contribution satisfies the assembly coverage check; removing
 *     it makes assembly fail loudly with the namespace name.
 */

import { describe, expect, it } from "vitest";
import daemonOpsModule from "./index.js";
import {
  jsonResponse,
  makeRecordingTransport,
} from "./scopes-daemon-client-test-support.js";

describe("daemon-ops module daemonClient(link) — scopes namespace", () => {
  it("contributes a scopes namespace handler", () => {
    const { transport } = makeRecordingTransport(() => jsonResponse(200, {}));
    const contributed = daemonOpsModule.daemonClient!(transport);
    expect(contributed.scopes).toBeDefined();
    expect(typeof contributed.scopes!.list).toBe("function");
    expect(typeof contributed.scopes!.use).toBe("function");
    expect(typeof contributed.scopes!.inspectOnboarding).toBe("function");
    expect(typeof contributed.scopes!.planOnboarding).toBe("function");
    expect(typeof contributed.scopes!.applyOnboarding).toBe("function");
    expect(typeof contributed.scopes!.getOnboardingStatus).toBe("function");
    expect(typeof contributed.scopes!.retryOnboarding).toBe("function");
    expect(typeof contributed.scopes!.cancelOnboarding).toBe("function");
  });

  it("routes list() through GET /scopes with auth headers and decodes the success arm", async () => {
    const wireBody = {
      rootScopeId: "global",
      defaultScopeId: "p1",
      activeScopeId: "p2" as string | null,
      scopes: [
        { scopeId: "global", displayName: "Global" },
        {
          scopeId: "p1",
          parentScopeId: "global",
          directoryRoot: "/tmp/p1",
          displayName: "p1",
        },
        {
          scopeId: "p2",
          parentScopeId: "global",
          directoryRoot: "/tmp/p2",
          displayName: "p2",
        },
      ],
    };
    const { transport, calls } = makeRecordingTransport(() => jsonResponse(200, wireBody));
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.scopes!.list();
    expect(result).toEqual({
      ok: true,
      scopes: [
        { scopeId: "p1", scopeRoot: "/tmp/p1", displayName: "p1" },
        { scopeId: "p2", scopeRoot: "/tmp/p2", displayName: "p2" },
      ],
      defaultScopeId: "p1",
      activeScopeId: "p2",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/scopes");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.headers).toEqual({ Authorization: "Bearer test-token" });
  });

  it("list() surfaces transport failure", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new TypeError("fetch failed");
    });
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.scopes!.list()).rejects.toThrow(/fetch failed/);
  });

  it("routes use(id) through PATCH /scopes/active with the scopeId in the body", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { activeScopeId: "p2" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.scopes!.use("p2");
    expect(result).toEqual({ ok: true, activeScopeId: "p2" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/scopes/active");
    expect(calls[0]!.init?.method).toBe("PATCH");
    expect(calls[0]!.init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ scopeId: "p2" });
  });

  it("use(null) clears the active selection through the same wire path", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { activeScopeId: null }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.scopes!.use(null);
    expect(result).toEqual({ ok: true, activeScopeId: null });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ scopeId: null });
  });

  it("use(id) decodes the not_found arm on a 404 response", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(404, {
        error: "Unknown scope",
        reason: "unknown_scope",
        scopeId: "ghost",
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.scopes!.use("ghost");
    expect(result).toEqual({ ok: false, reason: "not_found", scopeId: "ghost" });
  });

  it("use(id) preserves a known scope's unavailable hosting state", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(409, {
        error: "Scope p2 is drained",
        reason: "scope_not_hosted",
        scopeId: "p2",
        state: "drained",
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);

    await expect(contributed.scopes!.use("p2")).resolves.toEqual({
      ok: false,
      reason: "not_hosted",
      scopeId: "p2",
      state: "drained",
    });
  });

  it("use(id) surfaces transport failure", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new TypeError("fetch failed");
    });
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.scopes!.use("p1")).rejects.toThrow(/fetch failed/);
  });

  it("routes onboarding inspection and planning through the shared daemon service endpoints", async () => {
    const { transport, calls } = makeRecordingTransport((path) => path.endsWith("/inspect")
      ? jsonResponse(200, {
          inspectionId: "inspection-1",
          operationId: "onboarding-1",
          scopeId: "dir:external",
          directoryRoot: "/tmp/external",
          displayName: "external",
          kind: "directory",
          registered: false,
          hostingState: null,
          trust: null,
          policyRevision: 0,
          policyFragment: null,
          policy: null,
          existing: {
            kotaState: false,
            scopeConfig: false,
            taskQueue: false,
            inbox: false,
            guidance: [],
          },
          setup: [],
          blockers: [],
        })
      : jsonResponse(400, {
          ok: false,
          reason: "invalid_choices",
          message: "invalid automation mode",
        }));
    const scopes = daemonOpsModule.daemonClient!(transport).scopes!;

    await expect(scopes.inspectOnboarding!("/tmp/external")).resolves.toMatchObject({
      ok: true,
      inspection: { operationId: "onboarding-1", directoryRoot: "/tmp/external" },
    });
    await expect(scopes.planOnboarding!("/tmp/external", {
      trust: false,
      initialAutomationMode: "passive",
      writes: { mode: "none" },
    })).resolves.toEqual({
      ok: false,
      reason: "invalid_choices",
      message: "invalid automation mode",
    });

    expect(calls.map((call) => [call.init?.method, call.path])).toEqual([
      ["POST", "/scope-onboarding/inspect"],
      ["POST", "/scope-onboarding/plan"],
    ]);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      directoryRoot: "/tmp/external",
      choices: {
        trust: false,
        initialAutomationMode: "passive",
        writes: { mode: "none" },
      },
    });
  });

  it("routes drain and safe removal through the canonical scope lifecycle endpoints", async () => {
    const { transport, calls } = makeRecordingTransport((path) =>
      path.endsWith("/drain")
        ? jsonResponse(409, {
            ok: false,
            reason: "scope_busy",
            message: "Scope has active resources",
            scopeId: "scope-external",
            blockers: [],
          })
        : jsonResponse(200, {
            ok: true,
            status: "removed",
            scope: {
              scopeId: "scope-external",
              directoryRoot: "/tmp/external",
              displayName: "External",
            },
          }));
    const scopes = daemonOpsModule.daemonClient!(transport).scopes!;

    await expect(scopes.drain("scope-external")).resolves.toMatchObject({
      ok: false,
      reason: "scope_busy",
    });
    await expect(scopes.remove("scope-external")).resolves.toMatchObject({
      ok: true,
      status: "removed",
    });
    expect(calls.map((call) => [call.init?.method, call.path])).toEqual([
      ["POST", "/scopes/scope-external/drain"],
      ["DELETE", "/scopes/scope-external"],
    ]);
  });
});
