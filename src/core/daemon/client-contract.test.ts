/** Observable identity projection and daemon error-body behavior. */

import { describe, expect, it } from "vitest";
import type { CapabilityReadiness } from "./capability-readiness.js";
import {
  parseDaemonClientErrorBody,
  summarizeDaemonClientErrorBody,
} from "./client-error.js";
import {
  buildClientIdentity,
  DASHBOARD_CAPABILITY_ID,
} from "./client-identity.js";
import type { ScopeRegistryProjection } from "./scope-registry.js";

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

describe("thin-client boundary behavior", () => {
  describe("identity", () => {
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

  describe("error bodies", () => {
    it("parses the plain JSON error envelope", () => {
      const body = parseDaemonClientErrorBody({
        error: "Token rejected",
        code: "auth-invalid",
      });
      expect(body?.error).toBe("Token rejected");
      expect(body?.code).toBe("auth-invalid");
      expect(summarizeDaemonClientErrorBody(body)).toBe("Token rejected");
    });

    it("parses the typed-failure ok=false envelope", () => {
      const body = parseDaemonClientErrorBody({
        ok: false,
        reason: "semantic_unavailable",
      });
      expect(body?.reason).toBe("semantic_unavailable");
      expect(summarizeDaemonClientErrorBody(body)).toBe("semantic_unavailable");
    });

    it("parses the voice failure envelope with code", () => {
      const body = parseDaemonClientErrorBody({
        ok: false,
        error: "STT unavailable",
        code: "stt-unavailable",
      });
      expect(body?.error).toBe("STT unavailable");
      expect(body?.code).toBe("stt-unavailable");
    });

    it("falls back to raw text when the body is not JSON", () => {
      const body = parseDaemonClientErrorBody("Bad gateway");
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
