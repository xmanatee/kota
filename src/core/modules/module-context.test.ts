/**
 * Tests for the ModuleContext logging, secret, and tool-discovery APIs.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectSecretStore } from "#core/config/secrets.js";
import { legacyEffect } from "#core/tools/effect.js";
import { registerTool } from "#core/tools/index.js";
import {
  createRuntimeModuleLoader,
  installRenderingCapture,
  resetModuleContextTestState,
  TEXT_LOG_CONFIG,
} from "./module-context.test-helpers.js";
import type { ModuleContext } from "./module-types.js";

beforeEach(() => {
  resetModuleContextTestState();
  vi.restoreAllMocks();
});

afterEach(resetModuleContextTestState);

describe("ModuleContext.log", () => {
  it("provides info/warn/error/debug methods", async () => {
    const onLoad = vi.fn();
    const loader = createRuntimeModuleLoader({});
    await loader.load({ name: "log-test", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(typeof ctx.log.info).toBe("function");
    expect(typeof ctx.log.warn).toBe("function");
    expect(typeof ctx.log.error).toBe("function");
    expect(typeof ctx.log.debug).toBe("function");
  });

  it("prefixes messages with [module:<name>]", async () => {
    const chunks: string[] = [];
    installRenderingCapture(chunks);
    const onLoad = vi.fn();
    const loader = createRuntimeModuleLoader(TEXT_LOG_CONFIG);
    await loader.load({ name: "my-mod", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    ctx.log.info("hello world");
    expect(chunks).toContain("[module:my-mod] hello world");

    ctx.log.warn("watch out");
    expect(chunks).toContain("[module:my-mod] WARN: watch out");

    ctx.log.error("something broke");
    expect(chunks).toContain("[module:my-mod] ERROR: something broke");
  });

  it("debug only logs in verbose mode", async () => {
    const chunks: string[] = [];
    installRenderingCapture(chunks);

    const onLoadQuiet = vi.fn();
    const loaderQuiet = createRuntimeModuleLoader(TEXT_LOG_CONFIG, false);
    await loaderQuiet.load({ name: "quiet-mod", onLoad: onLoadQuiet });
    const ctxQuiet: ModuleContext = onLoadQuiet.mock.calls[0][0];
    ctxQuiet.log.debug("hidden");
    expect(chunks).not.toContain("[module:quiet-mod] DEBUG: hidden");

    const onLoadVerbose = vi.fn();
    const loaderVerbose = createRuntimeModuleLoader(TEXT_LOG_CONFIG, true);
    await loaderVerbose.load({ name: "verbose-mod", onLoad: onLoadVerbose });
    const ctxVerbose: ModuleContext = onLoadVerbose.mock.calls[0][0];
    ctxVerbose.log.debug("visible");
    const debugCall = chunks.find((chunk) => chunk.includes("DEBUG:"));
    expect(debugCall).toBeTruthy();
    expect(debugCall).toContain("[module:verbose-mod] DEBUG: visible");
  });
});

describe("ModuleContext.getSecret", () => {
  it("reads from the module project's secret store", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "module-context-secret-"));
    try {
      const onLoad = vi.fn();
      const loader = createRuntimeModuleLoader({});
      loader.setCwd(projectDir);
      await loader.load({ name: "secret-test", onLoad });

      const ctx: ModuleContext = onLoad.mock.calls[0][0];
      const secretName = "KOTA_MODULE_CONTEXT_PROJECT_SECRET";
      expect(ctx.getSecret(secretName)).toBeNull();
      getProjectSecretStore(ctx.cwd).set(
        secretName,
        "module-project-value",
        "project",
      );
      expect(ctx.getSecret(secretName)).toBe("module-project-value");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("does not read a different project's store", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "module-context-isolation-"));
    const otherProjectDir = mkdtempSync(
      join(tmpdir(), "module-context-isolation-other-"),
    );
    try {
      const secretName = "KOTA_MODULE_CONTEXT_ISOLATED_SECRET";
      getProjectSecretStore(otherProjectDir).set(
        secretName,
        "other-project-value",
        "project",
      );

      const onLoad = vi.fn();
      const loader = createRuntimeModuleLoader({});
      loader.setCwd(projectDir);
      await loader.load({ name: "secret-test2", onLoad });

      const ctx: ModuleContext = onLoad.mock.calls[0][0];
      expect(ctx.getSecret(secretName)).toBeNull();
      getProjectSecretStore(projectDir).set(
        secretName,
        "module-project-value",
        "project",
      );
      expect(ctx.getSecret(secretName)).toBe("module-project-value");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(otherProjectDir, { recursive: true, force: true });
    }
  });
});

describe("ModuleContext.listTools", () => {
  it("returns names of registered tools", async () => {
    registerTool(
      {
        name: "tool_alpha",
        description: "Test",
        input_schema: { type: "object", properties: {} },
      },
      async () => ({ content: "ok" }),
    );
    registerTool(
      {
        name: "tool_beta",
        description: "Test",
        input_schema: { type: "object", properties: {} },
      },
      async () => ({ content: "ok" }),
    );

    const onLoad = vi.fn();
    const loader = createRuntimeModuleLoader({});
    await loader.load({ name: "tools-test", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    const tools = ctx.listTools();
    expect(tools).toContain("tool_alpha");
    expect(tools).toContain("tool_beta");
  });

  it("reflects tools registered by other modules", async () => {
    const loader = createRuntimeModuleLoader({});

    await loader.load({
      name: "provider-mod",
      tools: [{
        tool: {
          name: "provided_tool",
          description: "Provided",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => ({ content: "ok" }),
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    });

    const onLoad = vi.fn();
    await loader.load({ name: "consumer-mod", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(ctx.listTools()).toContain("provided_tool");
  });
});
