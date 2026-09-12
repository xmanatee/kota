/**
 * Tests for the ModuleContext logging, secret, and tool-discovery APIs.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { getScopeSecretStore, resetSecretStores } from "#core/config/secrets.js";
import { EventBus } from "#core/events/event-bus.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import { readOnlyLocalEffect } from "#core/tools/effect.js";
import {
  captureDiagnostics,
  createModuleLoader,
  TEXT_LOG_CONFIG,
} from "./module-context.test-helpers.js";
import { ModuleLoader } from "./module-loader.js";
import type { ModuleContext } from "./module-types.js";

afterEach(resetSecretStores);

describe("ModuleContext.log", () => {
  it.each([false, true])("renders module diagnostics with verbose=%s", async (verbose) => {
    const chunks: string[] = [];
    captureDiagnostics(chunks);
    const loader = createModuleLoader(TEXT_LOG_CONFIG, verbose);
    await loader.load({
      name: "diagnostics",
      onLoad: (ctx) => {
        ctx.log.info("hello");
        ctx.log.warn("watch out");
        ctx.log.error("failed");
        ctx.log.debug("detail");
      },
    });
    const output = chunks.join("");
    expect(output).toContain("[module:diagnostics] hello");
    expect(output).toContain("[module:diagnostics] WARN: watch out");
    expect(output).toContain("[module:diagnostics] ERROR: failed");
    expect(output.includes("[module:diagnostics] DEBUG: detail")).toBe(verbose);
  });

  it("attributes typed operation health to the caller's scope rather than the module cwd", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "module-context-health-"));
    try {
      const bus = new EventBus();
      const failures: Array<BusEvents["module.operation.failed"]> = [];
      const recoveries: Array<BusEvents["module.operation.recovered"]> = [];
      bus.on("module.operation.recovered", (payload) => recoveries.push(payload));
      bus.on("module.operation.failed", (payload) => failures.push(payload));
      const onLoad = vi.fn();
      const loader = new ModuleLoader(TEXT_LOG_CONFIG, false, { mode: "runtime" });
      onTestFinished(() => loader.unloadAll());
      loader.setCwd(scopeRoot);
      loader.setBus(bus);
      await loader.load({ name: "health-source", onLoad });

      const ctx: ModuleContext = onLoad.mock.calls[0][0];
      ctx.log.error("diagnostic-only error");
      ctx.log.operationFailed?.("scope-operation", "poll-loop", "operation failed", {
        secret: "retained-only",
      });

      expect(failures).toEqual([
        {
          scopeId: "scope-operation",
          module: "health-source",
          operation: "poll-loop",
          failureKind: "unknown",
          causeKey: expect.stringMatching(/^poll-loop:unknown:/),
          observedAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(failures)).not.toContain("retained-only");
      ctx.log.operationFailed?.("scope-other", "poll-loop", "network timeout");
      ctx.log.operationFailed?.("scope-other", "poll-loop", "network timeout");
      ctx.log.operationRecovered?.("scope-operation", "poll-loop");
      ctx.log.operationRecovered?.("scope-other", "poll-loop");
      ctx.log.operationRecovered?.("scope-other", "poll-loop");
      expect(recoveries.map(({ scopeId, failures }) => ({ scopeId, failures }))).toEqual([
        {
          scopeId: "scope-operation",
          failures: [{ failureKind: "unknown", causeKey: failures[0]!.causeKey }],
        },
        {
          scopeId: "scope-other",
          failures: [{ failureKind: "provider", causeKey: "external-provider-failure" }],
        },
        { scopeId: "scope-other", failures: [] },
      ]);
      await loader.unloadAll();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});

describe("ModuleContext.getSecret", () => {
  it("does not read a different project's store", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "module-context-isolation-"));
    const otherScopeRoot = mkdtempSync(join(tmpdir(), "module-context-isolation-other-"));
    try {
      const secretName = "KOTA_MODULE_CONTEXT_ISOLATED_SECRET";
      getScopeSecretStore(otherScopeRoot).set(secretName, "other-scope-value", "scope");

      const onLoad = vi.fn();
      const loader = createModuleLoader({});
      loader.setCwd(scopeRoot);
      await loader.load({ name: "secret-test2", onLoad });

      const ctx: ModuleContext = onLoad.mock.calls[0][0];
      expect(ctx.getSecret(secretName)).toBeNull();
      getScopeSecretStore(scopeRoot).set(secretName, "module-project-value", "scope");
      expect(ctx.getSecret(secretName)).toBe("module-project-value");
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
      rmSync(otherScopeRoot, { recursive: true, force: true });
    }
  });
});

describe("ModuleContext.listTools", () => {
  it("reflects tools registered by other modules", async () => {
    const loader = createModuleLoader({});

    await loader.load({
      name: "provider-mod",
      tools: [
        {
          tool: {
            name: "provided_tool",
            description: "Provided",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "ok" }),
          effect: readOnlyLocalEffect(),
        },
      ],
    });

    const onLoad = vi.fn();
    await loader.load({ name: "consumer-mod", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(ctx.listTools()).toContain("provided_tool");
  });
});
