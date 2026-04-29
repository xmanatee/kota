/**
 * Thin-client contract conformance test.
 *
 * Decodes the shared JSON fixture under `clients/conformance/` and
 * exercises every typed surface the contract promises:
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
 * Both the macOS Swift suite and the web Vitest exercise the same
 * fixture file, so this test plus the macOS `ContractFixtureTests` plus
 * the web `client.test.ts` form the cross-client conformance gate.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  "../../../clients/conformance/contract-fixture.json",
);

type Fixture = {
  identity: ClientIdentity;
  identityWithoutDashboard: ClientIdentity;
  capabilities: CapabilityReadinessResponse;
  workflowDefinitions: { definitions: WorkflowDefinitionSummary[] };
  errorBodies: {
    json: unknown;
    typedFailure: unknown;
    voiceFailure: unknown;
    plainText: string;
  };
};

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
}

describe("thin-client contract — shared fixture", () => {
  const fixture = loadFixture();

  describe("identity", () => {
    it("decodes the dashboard-available identity payload", () => {
      const id = fixture.identity;
      expect(id.projectName).toBe("kota");
      expect(id.projectDir).toBe("/Users/operator/projects/kota");
      expect(id.daemonVersion).toBe("0.1.0");
      expect(id.pid).toBe(12345);
      expect(id.startedAt).toBe("2026-04-29T01:00:00.000Z");
      if (!id.dashboard.available) {
        throw new Error("expected dashboard.available=true in fixture");
      }
      expect(id.dashboard.path).toBe("/");
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
        projectDir: "/tmp/kota",
        pid: 7777,
        startedAt: "2026-04-29T01:00:00.000Z",
        capabilities: {
          capabilities: [ready],
          summary: { ready: 1, unavailable: 0, init_failed: 0 },
        },
      });
      expect(identity.projectName).toBe("kota");
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
        projectDir: "/tmp/kota",
        pid: 7777,
        startedAt: "2026-04-29T01:00:00.000Z",
        capabilities: {
          capabilities: [unavailable],
          summary: { ready: 0, unavailable: 1, init_failed: 0 },
        },
      });
      if (identity.dashboard.available) {
        throw new Error("expected dashboard.available=false");
      }
      expect(identity.dashboard.reason).toBe("web_ui_not_built");
      expect(identity.dashboard.message).toContain("clients/web/dist");
    });

    it("buildClientIdentity reports not_contributed when the web module never registered a dashboard", () => {
      const identity = buildClientIdentity({
        projectDir: "/tmp/kota",
        pid: 7777,
        startedAt: "2026-04-29T01:00:00.000Z",
        capabilities: {
          capabilities: [],
          summary: { ready: 0, unavailable: 0, init_failed: 0 },
        },
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
