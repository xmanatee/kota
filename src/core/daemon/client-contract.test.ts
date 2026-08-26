/**
 * Thin-client contract conformance test (daemon-side).
 *
 * Decodes the shared JSON fixture under `clients/conformance/` through
 * the daemon's source-of-truth typed shapes:
 *
 * - `GET /identity` returns the typed `ClientIdentity` payload built by
 *   `buildClientIdentity`, including the `dashboard.available` discriminator
 *   and the well-known `dashboard` capability id.
 * - `GET /capabilities` returns the typed `CapabilityReadinessResponse`
 *   shape with stable `id`, `status`, optional `reason`, and `meta`.
 * - `GET /workflow/definitions` returns the typed
 *   `WorkflowDefinitionSummary` array including optional `inputSchema`.
 * - The daemon error envelope decodes through
 *   `parseDaemonClientErrorBody` for JSON, typed-failure, voice-route,
 *   and plain-text bodies.
 *
 * The cross-store and digest/attention/voice surfaces are exercised by
 * the per-client conformance suites that consume
 * `clients/conformance/decoders.ts` and `decoders.test-cases.ts` through
 * the canonical fixture: the web Vitest
 * (`clients/web/src/api/contractFixture.test.ts`), the mobile Jest
 * (`clients/mobile/src/__tests__/contractFixture.test.ts`), and the
 * macOS Swift suite (`ContractFixtureTests.swift`). When the contract
 * drifts, every conformance suite fails together.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  CapabilityReadiness,
  CapabilityReadinessResponse,
} from "./capability-readiness.js";
import {
  parseDaemonClientErrorBody,
  summarizeDaemonClientErrorBody,
} from "./client-error.js";
import {
  buildClientIdentity,
  type ClientIdentity,
  DASHBOARD_CAPABILITY_ID,
  WORKFLOW_TRIGGER_CAPABILITY_ID,
} from "./client-identity.js";
import type { WorkflowDefinitionSummary } from "./daemon-control-types.js";
import type { ScopePolicyRouteResponse } from "./scope-policy.js";
import type { ScopeRegistryProjection } from "./scope-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  "../../../clients/conformance/contract-fixture.json",
);

type FixtureUnknownScopeError = {
  error: string;
  reason: string;
  scopeId: string;
};

type Fixture = {
  identity: ClientIdentity;
  identityWithoutDashboard: ClientIdentity;
  scopes: ScopeRegistryProjection;
  scopePolicy: {
    resolved: ScopePolicyRouteResponse;
    negative_unknownOutcome: unknown;
  };
  unknownScopeError: FixtureUnknownScopeError;
  capabilities: CapabilityReadinessResponse;
  workflowDefinitions: { definitions: WorkflowDefinitionSummary[] };
  errorBodies: {
    json: unknown;
    typedFailure: unknown;
    voiceFailure: unknown;
    plainText: string;
  };
};

const FAKE_SCOPES: ScopeRegistryProjection = {
  rootScopeId: "global",
  defaultScopeId: "test-scope-id",
  scopes: [
    { scopeId: "global", displayName: "Global" },
    {
      scopeId: "test-scope-id",
      parentScopeId: "global",
      directoryRoot: "/tmp/kota",
      displayName: "kota",
    },
  ],
};

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
}

describe("thin-client contract — shared fixture", () => {
  const fixture = loadFixture();

  describe("identity", () => {
    it("decodes the dashboard-available identity payload", () => {
      const id = fixture.identity;
      expect(id.scopeName).toBe("kota");
      expect(id.scopeRoot).toBe("/Users/operator/projects/kota");
      expect(id.daemonVersion).toBe("0.1.0");
      expect(id.pid).toBe(12345);
      expect(id.startedAt).toBe("2026-04-29T01:00:00.000Z");
      if (!id.dashboard.available) {
        throw new Error("expected dashboard.available=true in fixture");
      }
      expect(id.dashboard.path).toBe("/");
      expect(id.scopeRegistry.defaultScopeId).toBe("p-kota-fixture-default");
      expect(id.scopeRegistry.scopes.map((scope) => scope.scopeId)).toEqual([
        "global",
        "p-kota-fixture-default",
        "p-side-fixture",
      ]);
      expect(
        id.scopeRegistry.scopes.some(
          (scope) => scope.scopeId === id.scopeRegistry.defaultScopeId,
        ),
      ).toBe(true);
    });

    it("exposes the typed unknown_scope rejection envelope", () => {
      const err = fixture.unknownScopeError;
      expect(err.error).toBe("Unknown scope");
      expect(err.reason).toBe("unknown_scope");
      expect(err.scopeId).toBe("p-not-configured");
    });

    it("exposes the canonical scope projection as a distinct top-level fixture", () => {
      const scopes = fixture.scopes;
      expect(scopes.rootScopeId).toBe("global");
      expect(scopes.defaultScopeId).toBe("p-kota-fixture-default");
      expect(scopes.scopes.map((scope) => scope.scopeId)).toEqual([
        "global",
        "p-kota-fixture-default",
        "p-kota-fixture-feature",
        "p-side-fixture",
      ]);
      expect(scopes.scopes.find((scope) => scope.scopeId === "p-kota-fixture-feature")).toMatchObject({
        parentScopeId: "p-kota-fixture-default",
        directoryRoot: "/Users/operator/projects/kota/feature",
      });
      expect(scopes.scopes.filter((scope) => scope.directoryRoot)).toHaveLength(3);
    });

    it("exposes resolved nested scope policy with inherited, overridden, and blocked values", () => {
      const response = fixture.scopePolicy.resolved;
      expect(response.revision).toBe(7);
      expect(response.policy.scopeId).toBe("p-kota-fixture-feature");
      expect(response.policy.lineage).toEqual([
        "global",
        "p-kota-fixture-default",
        "p-kota-fixture-feature",
      ]);
      expect(response.policy.directoryRoot).toBe("/Users/operator/projects/kota/feature");
      expect(response.policy.retention.source.scopeId).toBe("global");
      expect(response.policy.channels.source.scopeId).toBe("p-kota-fixture-feature");
      expect(response.policy.writes.source.scopeId).toBe("p-kota-fixture-default");
      expect(response.policy.channels.blockedSources).toContain("fixture-blocked-chat");
      expect(response.decisionExamples.map((entry) => entry.outcome)).toEqual([
        "allow",
        "deny",
        "deny",
        "confirm",
      ]);
      expect(response.decisionExamples[1]?.rendered).toContain("-> deny");
      expect(response.decisionExamples[2]?.rendered).toContain("scope directory write boundary");
    });

    it("decodes the dashboard-unavailable identity payload", () => {
      const id = fixture.identityWithoutDashboard;
      if (id.dashboard.available) {
        throw new Error("expected dashboard.available=false in fixture");
      }
      expect(id.dashboard.reason).toBe("web_ui_not_built");
      expect(id.dashboard.message).toContain("Web dashboard is unavailable");
    });

    it("buildClientIdentity collapses a ready dashboard capability into the typed payload", () => {
      const ready: CapabilityReadiness = {
        id: DASHBOARD_CAPABILITY_ID,
        moduleName: "web",
        status: "ready",
        message: "dash up",
      };
      const identity = buildClientIdentity({
        scopeRoot: "/tmp/kota",
        pid: 7777,
        startedAt: "2026-04-29T01:00:00.000Z",
        capabilities: {
          capabilities: [ready],
          summary: { ready: 1, unavailable: 0, init_failed: 0 },
        },
        scopeRegistry: FAKE_SCOPES,
      });
      expect(identity.scopeName).toBe("kota");
      expect(identity.scopeRegistry.defaultScopeId).toBe("test-scope-id");
      if (!identity.dashboard.available) {
        throw new Error("expected dashboard.available=true");
      }
      expect(identity.dashboard.path).toBe("/");
    });

    it("buildClientIdentity surfaces an unavailable dashboard capability with its reason", () => {
      const unavailable: CapabilityReadiness = {
        id: DASHBOARD_CAPABILITY_ID,
        moduleName: "web",
        status: "unavailable",
        reason: "web_ui_not_built",
        message: "Run pnpm --filter @kota/web build to produce clients/web/dist.",
      };
      const identity = buildClientIdentity({
        scopeRoot: "/tmp/kota",
        pid: 7777,
        startedAt: "2026-04-29T01:00:00.000Z",
        capabilities: {
          capabilities: [unavailable],
          summary: { ready: 0, unavailable: 1, init_failed: 0 },
        },
        scopeRegistry: FAKE_SCOPES,
      });
      if (identity.dashboard.available) {
        throw new Error("expected dashboard.available=false");
      }
      expect(identity.dashboard.reason).toBe("web_ui_not_built");
      expect(identity.dashboard.message).toContain("clients/web/dist");
    });

    it("buildClientIdentity reports not_contributed when the web module never registered a dashboard", () => {
      const identity = buildClientIdentity({
        scopeRoot: "/tmp/kota",
        pid: 7777,
        startedAt: "2026-04-29T01:00:00.000Z",
        capabilities: {
          capabilities: [],
          summary: { ready: 0, unavailable: 0, init_failed: 0 },
        },
        scopeRegistry: FAKE_SCOPES,
      });
      if (identity.dashboard.available) {
        throw new Error("expected dashboard.available=false");
      }
      expect(identity.dashboard.reason).toBe("not_contributed");
    });
  });

  describe("capabilities", () => {
    it("decodes the typed capability readiness response shape", () => {
      const caps = fixture.capabilities;
      expect(caps.summary).toEqual({ ready: 3, unavailable: 1, init_failed: 0 });
      const dash = caps.capabilities.find((c) => c.id === DASHBOARD_CAPABILITY_ID);
      expect(dash?.status).toBe("ready");
      const triggers = caps.capabilities.find(
        (c) => c.id === WORKFLOW_TRIGGER_CAPABILITY_ID,
      );
      expect(triggers?.meta?.enabled).toBe(8);
      const semantic = caps.capabilities.find(
        (c) => c.id === "knowledge.semantic_search",
      );
      expect(semantic?.status).toBe("unavailable");
      expect(semantic?.reason).toBe("embedding_unsupported");
    });
  });

  describe("workflow definitions", () => {
    it("decodes the typed workflow-definition summary including inputSchema", () => {
      const defs = fixture.workflowDefinitions.definitions;
      expect(defs).toHaveLength(2);
      const decomposer = defs.find((d) => d.name === "decomposer");
      expect(decomposer?.inputSchema).toBeDefined();
      if (!decomposer?.inputSchema) {
        throw new Error("expected decomposer to declare inputSchema");
      }
      expect(decomposer.triggers[0]).toMatchObject({
        type: "event",
        event: "autonomy.queue.available",
      });
    });
  });

  describe("error bodies", () => {
    it("parses the plain JSON error envelope", () => {
      const body = parseDaemonClientErrorBody(fixture.errorBodies.json);
      expect(body?.error).toBe("Token rejected");
      expect(body?.code).toBe("auth-invalid");
      expect(summarizeDaemonClientErrorBody(body)).toBe("Token rejected");
    });

    it("parses the typed-failure ok=false envelope", () => {
      const body = parseDaemonClientErrorBody(fixture.errorBodies.typedFailure);
      expect(body?.reason).toBe("semantic_unavailable");
      expect(summarizeDaemonClientErrorBody(body)).toBe("semantic_unavailable");
    });

    it("parses the voice failure envelope with code", () => {
      const body = parseDaemonClientErrorBody(fixture.errorBodies.voiceFailure);
      expect(body?.error).toBe("STT unavailable");
      expect(body?.code).toBe("stt-unavailable");
    });

    it("falls back to raw text when the body is not JSON", () => {
      const body = parseDaemonClientErrorBody(fixture.errorBodies.plainText);
      expect(body?.raw).toContain("Bad gateway");
      expect(body?.error).toBeUndefined();
      expect(summarizeDaemonClientErrorBody(body)).toContain("Bad gateway");
    });

    it("returns null for an empty body", () => {
      expect(parseDaemonClientErrorBody("")).toBeNull();
      expect(summarizeDaemonClientErrorBody(null)).toBeNull();
    });
  });
});
