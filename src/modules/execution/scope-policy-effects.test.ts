import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { resolveModuleTools } from "#core/modules/module-types.js";
import {
  clearCustomTools,
  getToolEffect,
  registerTool,
} from "#core/tools/index.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import executionModule from "./index.js";

const policy = resolveScopePolicy({
  projection: {
    rootScopeId: "global",
    defaultScopeId: "workspace",
    scopes: [
      { scopeId: "global", displayName: "Global" },
      {
        scopeId: "workspace",
        displayName: "Workspace",
        parentScopeId: "global",
        directoryRoot: "/tmp/workspace",
      },
    ],
  },
  scopeId: "workspace",
  fragments: [{
    scopeId: "workspace",
    reason: "External execution effects are disabled.",
    externalEffects: {
      networkRead: "deny",
      networkWrite: "deny",
      networkDestructive: "deny",
    },
  }],
});

beforeEach(() => {
  for (const definition of resolveModuleTools(executionModule)) {
    if (!["shell", "process", "code_exec"].includes(definition.tool.name)) {
      continue;
    }
    registerTool(definition.tool, definition.runner, executionModule.name, {
      effect: definition.effect,
      ...(definition.resolveEffect
        ? { resolveEffect: definition.resolveEffect }
        : {}),
    });
  }
});

afterEach(() => clearCustomTools());

describe("execution tool scope-policy effects", () => {
  it("classifies handoffs granting real execution tools as externally destructive", () => {
    for (const name of ["shell", "process", "code_exec"]) {
      expect(getToolEffect("handoff_agent", {
        allowed_tools: [name],
      }), name).toMatchObject({
        kind: "destructive",
        scope: "external-network",
        openWorld: true,
      });
    }
  });

  it("resolves real shell, process, and code registrations to network effects", () => {
    expect(getToolEffect("shell", {
      command: "curl https://example.com/status",
    })).toMatchObject({ kind: "read", scope: "external-network" });
    expect(getToolEffect("process", {
      action: "start",
      command: "wget https://example.com/archive.tgz",
    })).toMatchObject({ kind: "read", scope: "external-network" });
    expect(getToolEffect("code_exec", {
      language: "node",
      code: "await fetch('https://example.com/items', { method: 'POST' })",
    })).toMatchObject({ kind: "write", scope: "external-network" });
    expect(getToolEffect("shell", {
      command: "curl -X DELETE https://example.com/items/1",
    })).toMatchObject({ kind: "destructive", scope: "external-network" });
  });

  it("blocks real registered execution tools before they can reach the network", async () => {
    const calls = [
      {
        type: "tool_use" as const,
        id: "shell-network",
        name: "shell",
        input: { command: "curl https://example.com/status" },
      },
      {
        type: "tool_use" as const,
        id: "process-network",
        name: "process",
        input: {
          action: "start",
          command: "node -e \"require('node:https').get('https://example.com')\"",
        },
      },
      {
        type: "tool_use" as const,
        id: "code-network",
        name: "code_exec",
        input: {
          language: "node",
          code: "await fetch('https://example.com/items', { method: 'POST' })",
        },
      },
    ];

    const results = await executeToolCalls(calls, {
      resultLimit: 20_000,
      verbose: false,
      autonomyMode: "autonomous",
      scopePolicy: policy,
      cwd: "/tmp/workspace",
    });

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result).toMatchObject({ is_error: true });
      expect(result.content).toContain("Blocked by scope policy");
      expect(result.content).toContain("external-network");
    }
  });

  it("retains the local-write decision for network-capable commands", async () => {
    const noWrites = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: "workspace",
        scopes: [
          { scopeId: "global", displayName: "Global" },
          {
            scopeId: "workspace",
            displayName: "Workspace",
            parentScopeId: "global",
            directoryRoot: "/tmp/workspace",
          },
        ],
      },
      scopeId: "workspace",
      fragments: [{
        scopeId: "workspace",
        reason: "The workspace is read-only.",
        writes: { mode: "none" },
      }],
    });

    const [result] = await executeToolCalls([{
      type: "tool_use",
      id: "compound-network-local",
      name: "shell",
      input: { command: "curl https://example.com/status" },
    }], {
      resultLimit: 20_000,
      verbose: false,
      autonomyMode: "autonomous",
      scopePolicy: noWrites,
      cwd: "/tmp/workspace",
    });

    expect(result).toMatchObject({ is_error: true });
    expect(result.content).toContain("local filesystem writes are disabled");
  });
});
