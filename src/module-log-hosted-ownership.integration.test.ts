import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessRunOptions,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { readOnlyLocalEffect } from "#core/tools/effect.js";
import { registerTool } from "#core/tools/index.js";
import type { ToolResultEntry } from "#core/tools/tool-runner.js";
import { StandaloneRunHost } from "#core/workflow/standalone-run-host.js";
import { executeOpenaiToolCalls } from "#modules/openai-tools-agent-harness/adapter-runtime.js";
import { TelegramMessageRuntime } from "#modules/telegram/bot-message-runtime.js";

// Exercise real standalone admission and storage; only the host listener probe
// is controlled because this journey does not open a network service.
vi.mock("#core/workflow/run-resources.js", async (original) => {
  const actual = await original<typeof import("#core/workflow/run-resources.js")>();
  return {
    ...actual,
    RunResourceAllocator: class extends actual.RunResourceAllocator {
      constructor(
        store: import("#core/workflow/run-state-database.js").RunStateDatabase,
        options: import("#core/workflow/run-resources.js").RunResourceAllocatorOptions,
      ) {
        super(store, { ...options, isPortAvailable: async () => true });
      }
    },
  };
});

// Detect lost live ownership both when a hosted loop is nested inside a tool
// and through both workflow entry points for hosted agents.
describe("hosted module log ownership", () => {
  // Detect loss of host ownership across Telegram's session creation and harness
  // dispatch, including later turns in the same conversation after withdrawal.
  it("Telegram harness sessions reject named queries and listings after provider withdrawal", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-telegram-log-"));
    const host = new StandaloneRunHost({
      stateDir: join(root, "state"),
      scope: buildDirectoryScope({ scopeRoot: root }),
      workflows: [],
    });
    const loader = new ModuleLoader({}, false, {
      scopeRoot: root,
      providerRegistry: host.providerRegistry,
    });
    const observed: ToolResultEntry[][] = [];
    const replies: string[] = [];
    const identities: Array<string | undefined> = [];
    const harness: AgentHarness = {
      name: "telegram-log-probe",
      description: "Deterministic Telegram tool stimulus",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        identities.push(options.sessionContext?.sessionId);
        const results = await executeOpenaiToolCalls([
          { type: "tool_use", id: "named", name: "module_factory", input: { action: "logs", name: "audit-probe" } },
          { type: "tool_use", id: "listing", name: "module_factory", input: { action: "logs" } },
        ], options, {
          scopeRoot: root,
          mcpManager: undefined,
          mcpPromptToolDeclarationFingerprints: undefined,
          abortSignal: undefined,
          messages: [],
        });
        observed.push(results);
        const text = results.map((result) => result.content).join("\n");
        return { text, streamedText: text, turns: 1, usage: UNKNOWN_AGENT_USAGE, isError: false };
      },
    };
    const releaseHarness = registerAgentHarness(harness);
    class TelegramMessages extends TelegramMessageRuntime {
      receive(text: string) { return this.handleMessage(42, text, "Operator"); }
      close() { return this.closeSessionsForChat(42); }
    }
    const bot = new TelegramMessages({
      token: "fixture-token",
      config: { defaultAgentHarness: harness.name, model: "test-model" },
      autonomyMode: "autonomous",
      moduleLoader: loader,
      defaultScopeRuntime: host.scopeRuntime,
      getScopeRuntime: () => host.scopeRuntime,
      http: outboundHttpRequestPort(async (request) => {
        if (request.operation === "telegram.sendMessage") {
          replies.push(String(request.body));
        }
        return Response.json({ ok: true, result: true });
      }),
    });
    vi.stubEnv("KOTA_PRESET", "");
    try {
      host.scopeRuntime.moduleLogStore.append("audit-probe", "info", "TELEGRAM_SCOPE_SENTINEL");
      await bot.receive("Inspect module logs");
      host.providerRegistry.unregisterOwner("standalone-run-host");
      await bot.receive("Inspect module logs again");
      expect(observed).toHaveLength(2);
      expect(identities[0]).toMatch(/^telegram:/);
      expect(identities[1]).toBe(identities[0]);
      for (const live of observed[0]) {
        expect(live.is_error).not.toBe(true);
        expect(live.content).toContain("TELEGRAM_SCOPE_SENTINEL");
      }
      for (const withdrawn of observed[1]) {
        expect(withdrawn.is_error).toBe(true);
        expect(withdrawn.content).toContain("unavailable");
        expect(withdrawn.content).not.toContain("TELEGRAM_SCOPE_SENTINEL");
      }
      expect(replies).toHaveLength(2);
      expect(replies[0]).toContain("TELEGRAM_SCOPE_SENTINEL");
      expect(replies[1]).toContain("unavailable");
      expect(replies[1]).not.toContain("TELEGRAM_SCOPE_SENTINEL");
      expect(host.scopeRuntime.moduleLogStore.tail("audit-probe")[0].msg)
        .toBe("TELEGRAM_SCOPE_SENTINEL");
    } finally {
      vi.unstubAllEnvs();
      await bot.close();
      releaseHarness();
      await host.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["nested-tool", "agent-step", "code-step-harness"] as const)(
    "%s rejects withdrawn ownership even while canonical logs remain on disk",
    async (entry) => {
      const root = mkdtempSync(join(tmpdir(), "kota-hosted-log-"));
      const scopeRoot = join(root, "project");
      const worktree = join(root, "worktree");
      mkdirSync(scopeRoot);
      mkdirSync(worktree);
      writeFileSync(join(scopeRoot, "prompt.md"), "Inspect the module logs.");
      const scope = buildDirectoryScope({ scopeRoot });
      const observed: ToolResultEntry[][] = [];
      let host: StandaloneRunHost;

      const inspect = async (options: AgentHarnessRunOptions) => {
        const read = () => executeOpenaiToolCalls(
          [
            { type: "tool_use", id: "named", name: "module_factory", input: { action: "logs", name: "audit-probe" } },
            { type: "tool_use", id: "listing", name: "module_factory", input: { action: "logs" } },
          ],
          options,
          {
            scopeRoot: worktree,
            mcpManager: undefined,
            mcpPromptToolDeclarationFingerprints: undefined,
            abortSignal: undefined,
            messages: [],
          },
        );
        observed.push(await read());
        host.providerRegistry.unregisterOwner("standalone-run-host");
        observed.push(await read());
        return { content: "Ownership probe completed" };
      };
      const harness: AgentHarness = {
        name: "hosted-log-probe",
        description: "Deterministic hosted tool stimulus",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: null,
        emitsAgentMessageStream: false,
        toolControl: "kota",
        run: async (options) => {
          const result = await inspect(options);
          return { text: result.content, streamedText: result.content, turns: 1, usage: UNKNOWN_AGENT_USAGE, isError: false };
        },
      };
      const releaseHarness = registerAgentHarness(harness);
      const releaseTool = registerTool({
        name: "hosted_log_probe",
        description: "Inspect through a nested hosted loop",
        input_schema: { type: "object", properties: {} },
      }, () => inspect({
        prompt: "Inspect logs",
        effort: "low",
        scopeRoot,
        cwd: worktree,
        sessionContext: { sessionId: "nested-log-probe", scopeId: scope.scopeId },
      }), "hosted-log-probe", { effect: readOnlyLocalEffect() });
      try {
        host = new StandaloneRunHost({
          stateDir: join(root, "state"),
          scope,
          workflows: [{
            name: "inspect-logs",
            enabled: true,
            repository: "none",
            moduleRoot: scopeRoot,
            definitionPath: "hosted-log-probe",
            tags: [],
            triggers: [],
            steps: entry === "nested-tool" ? [{
              id: "inspect",
              type: "code",
              run: (ctx) => ctx.runTool("hosted_log_probe", {}),
            }] : entry === "code-step-harness" ? [{
              id: "inspect",
              type: "code",
              run: (ctx) => ctx.runAgentHarness(harness, {
                prompt: "Inspect logs",
                model: "test-model",
                effort: "low",
                cwd: worktree,
                sessionContext: { sessionId: "code-step-log-probe", scopeId: scope.scopeId },
              }),
            }] : [{
              id: "inspect",
              type: "agent",
              harness: harness.name,
              promptPath: "prompt.md",
              model: "test-model",
              effort: "low",
              autonomyMode: "autonomous",
            }],
          }],
        });
        try {
          host.scopeRuntime.moduleLogStore.append("audit-probe", "info", "CANONICAL_SCOPE_SENTINEL");
          const result = await host.runToTerminal("inspect-logs");
          expect(result.run.state, result.run.lastError).toBe("succeeded");
          expect(observed).toHaveLength(2);
          for (const live of observed[0]) {
            expect(live.is_error).not.toBe(true);
            expect(live.content).toContain("CANONICAL_SCOPE_SENTINEL");
          }
          for (const withdrawn of observed[1]) {
            expect(withdrawn.is_error).toBe(true);
            expect(withdrawn.content).toContain("unavailable");
            expect(withdrawn.content).not.toContain("CANONICAL_SCOPE_SENTINEL");
          }
          expect(host.scopeRuntime.moduleLogStore.tail("audit-probe")[0].msg)
            .toBe("CANONICAL_SCOPE_SENTINEL");
        } finally {
          await host.close();
        }
      } finally {
        releaseTool();
        releaseHarness();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
