import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { outboundHttp } from "#core/outbound-http/index.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import { StandaloneRunHost } from "#core/workflow/standalone-run-host.js";
import type { WorkflowCommandRunner, WorkflowCommandRunnerOptions } from "#core/workflow/workflow-command.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import repoTaskMutationWorkflow from "#modules/repo-tasks/repo-task-mutation-workflow.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { RetractProviderImpl } from "#modules/retract/retract-provider.js";
import { dispatchSlackSlashCommand, parseSlackSlashCommand } from "#modules/slack-channel/commands.js";
import { TelegramScopeSelection } from "#modules/telegram/scope-selection.js";
import { handleTelegramStatusCommand } from "#modules/telegram/status-commands.js";

// This journey opens no listeners. Control only the OS availability probe;
// the runtime still allocates and releases its real durable port resources.
vi.mock("node:net", async original => ({
  ...await original<typeof import("node:net")>(),
  createServer: () => ({
    unref() {},
    once() {},
    listen(_options: unknown, ready: () => void) { ready(); },
    close(closed: () => void) { closed(); },
  }),
}));

// Run the domain validator in process; process supervision is independently
// verified by the runtime owner and is unavailable in some builder sandboxes.
vi.mock("#core/workflow/workflow-command.js", async original => ({
  ...await original<typeof import("#core/workflow/workflow-command.js")>(),
  createWorkflowCommandRunner: (options: WorkflowCommandRunnerOptions): WorkflowCommandRunner => async input => {
    expect(input.command).toBe("validate-task-queue-in-process");
    assertTaskQueueValid(options.cwd);
    return {
      command: input.command, args: [], cwd: options.cwd, exitCode: 0,
      identity: { pid: 1, processGroupId: 1, observedCommandHash: "controlled-port", osStartToken: "controlled-port" },
      stdout: { text: "Task queue valid (in-process)", totalBytes: 29, truncated: false },
      stderr: { text: "", totalBytes: 0, truncated: false },
    };
  },
}));

// Distinct composition failure: chat replies could claim a write/correction while
// losing multiline content, bypassing repo-task validation or changing another
// scope. Real domain owners and writer lifecycle; HTTP and OS/process ports
// are controlled as described above.
it("delivers capture and correction replies for effects in the selected scope", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-mutation-command-"));
  for (const name of ["a", "b"]) mkdirSync(join(root, name));
  const scopeA = buildDirectoryScope({ scopeRoot: join(root, "a") });
  const scopeB = buildDirectoryScope({ scopeRoot: join(root, "b") });
  writeFileSync(join(scopeB.scopeRoot, ".gitignore"), ".kota/\n");
  for (const args of [["init", "--quiet", "--initial-branch=main"], ["config", "user.name", "KOTA Test"], ["config", "user.email", "kota@example.test"], ["add", "--all"], ["commit", "--quiet", "--message", "baseline"]]) {
    execFileSync("git", args, { cwd: scopeB.scopeRoot });
  }
  initProviderRegistry();
  const host = new StandaloneRunHost({
    stateDir: join(root, "state"), scope: scopeB, bus: new EventBus(),
    workflows: [{ name: "command-journey-ready", definitionPath: "command-journey-ready", moduleRoot: scopeB.scopeRoot, enabled: true, repository: "none", triggers: [{ event: "manual" }],
      steps: [{ id: "ready", type: "code", run: () => ({ ready: true }) }] }, { ...repoTaskMutationWorkflow, enabled: true, moduleRoot: scopeB.scopeRoot,
      definitionPath: "mutation-command-journey", integration: { ...repoTaskMutationWorkflow.integration!, validationCommand: ["validate-task-queue-in-process"] } }],
  });
  const replies: Array<{ destination: string | number; text: string }> = [];
  vi.spyOn(outboundHttp, "request").mockImplementation(outboundHttpRequestPort(request => {
    const body = JSON.parse(String(request.body));
    replies.push({ destination: body.chat_id ?? body.channel, text: body.text });
    return Response.json({ ok: true, result: { message_id: 1 } });
  }).request);
  try {
    // Standalone hosts begin paused; a read-only workflow starts their dispatcher.
    const warmup = await host.runToTerminal("command-journey-ready");
    expect(warmup.run.state).toBe("succeeded");
    const stores = [scopeA, scopeB].map(scope => ({
      ...scope, memory: new MemoryStore(join(scope.scopeRoot, ".kota")),
      knowledge: new KnowledgeStore(scope.scopeRoot, join(root, "global")),
      getWorkflowDispatcher: () => scope.scopeId === scopeB.scopeId ? host.scopeRuntime.workflowRuntime : null,
    }));
    const scopedClients = stores.map(scope => createKotaClientTestDouble({
      capture: new CaptureProviderImpl({ resolveScopeContext: () => scope }),
      retract: new RetractProviderImpl({ resolveScopeContext: () => scope }),
    }));
    const client = createKotaClientTestDouble({ scopes: { list: async () => ({ ok: true, scopes: [scopeA, scopeB], defaultScopeId: scopeA.scopeId, activeScopeId: null }) } }, id => {
      const index = stores.findIndex(scope => scope.scopeId === id);
      if (index < 0) throw new Error("Unknown scope");
      return scopedClients[index]!;
    });
    const selection = new TelegramScopeSelection(client, new ModuleStorage(root, "telegram"), []);
    const defaultScope = { ...scopedClients[0]!, scopeRoot: scopeA.scopeRoot, getStatusInfo: () => { throw new Error("Unused status"); } };
    const telegram = async (text: string) => {
      expect(await handleTelegramStatusCommand({ token: "test", messageChatId: 99, text, defaultScope, scopeRouting: { client, selection } })).toBe(true);
      return replies.at(-1)!.text;
    };
    const slack = async (text: string) => {
      const parsed = parseSlackSlashCommand(text);
      if (!parsed) throw new Error("Expected slash command");
      expect(await dispatchSlackSlashCommand({ token: "test", channelId: "D-OWNER", parsed,
        clients: { ...scopedClients[1]!, attention: { snapshot: () => ({ text: "" }) }, digest: { snapshot: () => ({ text: "" }) } },
      })).toBe(true);
      return replies.at(-1)!.text;
    };
    expect(await telegram("/capture-to-tasks Denied task")).toContain("not bound to a KOTA scope");
    expect(existsSync(join(scopeB.scopeRoot, "data"))).toBe(false);
    await telegram(`/scope ${scopeB.scopeId}`);
    expect(await telegram("/capture-to-tasks  \n ")).toContain("Capture target ambiguous");
    expect(await slack("/retract-tasks  ")).toBe("Usage: /retract-tasks <id>");
    expect(existsSync(join(scopeB.scopeRoot, "data"))).toBe(false);
    const body = "Shared command task\n\n  Keep this detail\nand this last line.";
    const active = "data/tasks/task-shared-command-task.md";
    const archived = "data/tasks/archive/task-shared-command-task.md";
    expect(await telegram(`/capture-to-tasks ${body}`)).toBe(`Captured to tasks: task-shared-command-task (${active})`);
    expect(readFileSync(join(scopeB.scopeRoot, active), "utf8")).toContain(body);
    expect(await slack("/retract-tasks task-shared-command-task")).toBe(`Retracted: tasks  task-shared-command-task  ${active} -> ${archived} (dropped)`);
    expect(existsSync(join(scopeB.scopeRoot, active))).toBe(false);
    expect(readFileSync(join(scopeB.scopeRoot, archived), "utf8")).toContain("status: dropped");
    expect(readFileSync(join(scopeB.scopeRoot, archived), "utf8")).toContain(body);
    expect(await slack("/capture Rough idea\n\nKeep context")).toBe("Captured to inbox: note-rough-idea (data/inbox/note-rough-idea.md)");
    expect(readFileSync(join(scopeB.scopeRoot, "data/inbox/note-rough-idea.md"), "utf8")).toBe("Rough idea\n\nKeep context");
    expect(await telegram("/retract-inbox data/inbox/note-rough-idea.md")).toBe("Retracted: inbox  note-rough-idea  data/inbox/note-rough-idea.md");
    expect(existsSync(join(scopeB.scopeRoot, "data/inbox/note-rough-idea.md"))).toBe(false);
    expect(await telegram("/capture-to-tasks !!!")).toContain("rejected an invalid title");
    expect(await slack("/retract-tasks ../outside")).toContain("invalid identifier");
    expect(existsSync(join(scopeA.scopeRoot, "data"))).toBe(false);
    expect(stores[0]!.memory.list()).toEqual([]);
    expect(replies.filter(reply => reply.destination === 99).length).toBeGreaterThan(0);
    expect(replies.filter(reply => reply.destination === "D-OWNER").length).toBeGreaterThan(0);
    process.stdout.write(`${JSON.stringify({ kind: "controlled-dispatcher-transcript", replies, effects: { scopeAUnchanged: true, taskArchivedDroppedWithCompleteBody: true, inboxCapturedThenRemoved: true } }, null, 2)}\n`);
  } finally {
    vi.restoreAllMocks();
    await host.close();
    resetProviderRegistry();
    rmSync(root, { recursive: true, force: true });
  }
});
