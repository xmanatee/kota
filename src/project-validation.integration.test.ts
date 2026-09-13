import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerAgentHarness, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import * as sandboxLaunch from "#core/agent-harness/machine-authority-sandbox.js";
import { loadConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-directory.js";
import { EventBus } from "#core/events/event-bus.js";
import { createTestWorkflowRuntime } from "#core/workflow/testing/runtime-fixture.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { listBuilderTaskDispatches } from "#modules/autonomy/workflows/builder/task-contract.js";
import builder from "#modules/autonomy/workflows/builder/workflow.js";
import { moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";

// Control OS launch and socket availability only. Configuration, native authority,
// command processes, task validation, reconciliation and publication remain real.
// The sandbox owner's live suite separately verifies OS enforcement.
vi.mock("node:net", async (original) => ({
  ...await original<typeof import("node:net")>(),
  createServer: () => {
    const server = {
      unref: () => server, once: () => server,
      listen: (_options: unknown, ready: () => void) => { ready(); return server; },
      close: (closed: () => void) => { closed(); return server; },
    };
    return server;
  },
}));

// Observe only subprocesses launched by this test; no host process table is needed.
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const running = new Set<number>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      if (child.pid !== undefined) {
        const pid = child.pid;
        running.add(pid);
        child.once("exit", () => running.delete(pid));
      }
      return child;
    },
    spawnSync: (command: string, args: string[], options: object) => {
      if (command !== "/bin/ps") return actual.spawnSync(command, args, options);
      const selected = args.includes("-p") ? [Number(args.at(-1))] : [...running];
      return { status: 0, stdout: selected.filter((pid) => running.has(pid))
        .map((pid) => `${pid} ${pid} Sun Sep 13 00:00:00 2026 fixture-process`).join("\n"), stderr: "" };
    },
  };
});

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "kota-project-validation-"))); });
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}
function commit(cwd: string): void {
  git(cwd, "add", ".");
  git(cwd, "-c", "user.name=Verification", "-c", "user.email=verify@example.test", "commit", "--quiet", "-m", "fixture change");
}

// Detects KOTA-script coupling, config bleed across scopes, pre-rebase checking,
// skipped domain validation and publication before a failing check is repaired.
it("publishes two differently tooled Git roots and repairs rejected checks through the existing continuation", async () => {
  const scopeRoots = [join(root, "shell-project"), join(root, "node-project")];
  const authorityConfigPath = join(root, "machine.json");
  writeFileSync(authorityConfigPath, JSON.stringify({ trustedScopes: scopeRoots }));
  const launches: string[] = [];
  vi.spyOn(sandboxLaunch, "buildMachineAuthoritySandboxLaunch").mockImplementation((command, args, options) => {
    expect(options.networkAccess).toEqual({ kind: "offline" });
    expect(options.writableRoots).toContain(options.cwd);
    expect(options.writableRoots).not.toContain(root);
    expect(options.writeProtectedPaths).toContain(join(options.cwd!, ".git"));
    launches.push(options.cwd!);
    return { ok: true, command, args: [...args] };
  });

  for (const [index, scopeRoot] of scopeRoots.entries()) {
    mkdirSync(join(scopeRoot, "data/tasks"), { recursive: true });
    mkdirSync(join(scopeRoot, ".kota"));
    writeFileSync(join(scopeRoot, ".gitignore"), ".kota/\n");
    writeFileSync(join(scopeRoot, "data/tasks/task-project.md"), "---\nstatus: open\npriority: p1\n---\n# Project change\n\nVerify publication with this project's tooling.\n");
    const command = index === 0 ? ["/bin/sh", "verify.sh"] : [process.execPath, "verify.mjs"];
    writeFileSync(join(scopeRoot, ".kota/config.json"), JSON.stringify({ workflow: { validationCommand: command } }));
    if (index === 0) writeFileSync(join(scopeRoot, "verify.sh"), 'test "$(cat reconciled.txt)" = canonical || exit 1\ntest "$(cat result.txt)" = ready || { echo project-check-rejected >&2; exit 1; }\necho shell-project-verified\n');
    else writeFileSync(join(scopeRoot, "verify.mjs"), 'import { readFileSync } from "node:fs";\nif (readFileSync("reconciled.txt", "utf8") !== "canonical" || readFileSync("result.txt", "utf8") !== "ready") { console.error("project-check-rejected"); process.exit(1); }\nconsole.log("node-project-verified");\n');
    git(scopeRoot, "init", "--quiet");
    commit(scopeRoot);
    const payload = listBuilderTaskDispatches(scopeRoot)[0]!;
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    let repairs = 0;
    let workspace = "";
    registerAgentHarness({
      name: "project-validation-repair", description: "Controlled integration repair agent", supportsMultiTurn: false,
      supportedHookKinds: [], askOwnerToolName: null, toolControl: "kota", emitsAgentMessageStream: false,
      run: async (options) => {
        repairs++;
        expect(options.cwd).toBe(workspace);
        expect(readFileSync(join(workspace, "reconciled.txt"), "utf8")).toBe("canonical");
        expect(existsSync(join(scopeRoot, "data/tasks/task-project.md"))).toBe(true);
        expect(existsSync(join(scopeRoot, "result.txt"))).toBe(false);
        if (index === 0) {
          expect(options.prompt).toContain("priority");
          rmSync(join(workspace, "data/tasks/task-invalid.md"));
        } else {
          expect(options.prompt).toContain("project-check-rejected");
          writeFileSync(join(workspace, "result.txt"), "ready");
        }
        return { text: "Repaired", streamedText: "Repaired", turns: 1, isError: false, usage: UNKNOWN_AGENT_USAGE };
      },
    });
    const config = loadConfig(root, {
      defaultAgentHarness: "project-validation-repair",
      workflow: { validationCommand: ["must-not-use-host-project-check"] },
    }, { globalConfigPath: authorityConfigPath });
    const host = createTestWorkflowRuntime({
      scopeRoot, scopeId, bus: new EventBus(), config, authorityConfigPath,
      workflows: [registerWorkflowDefinition("project-validation.scenario.ts", {
        ...builder,
        recovery: undefined,
        steps: [{ id: "build", type: "code", run: (ctx) => {
          workspace = ctx.workspaceRoot;
          expect(workspace).not.toBe(scopeRoot);
          mkdirSync(join(workspace, ".kota"), { recursive: true });
          writeFileSync(join(workspace, ".kota/config.json"), JSON.stringify({
            workflow: { validationCommand: ["must-not-use-candidate-command"] },
          }));
          moveTaskById(workspace, payload.taskId, "done");
          writeFileSync(join(workspace, "result.txt"), index === 0 ? "ready" : "broken");
          if (index === 0) writeFileSync(join(workspace, "data/tasks/task-invalid.md"), "---\nstatus: open\npriority: invalid\n---\n# Invalid task\n\nReject this record.\n");
          // An independent canonical commit arrives after writer allocation.
          writeFileSync(join(scopeRoot, "reconciled.txt"), "canonical");
          commit(scopeRoot);
          return "Prepared project change";
        } }],
      })],
    });
    try {
      host.runtime.start();
      const result = await host.runtime.execute({ scopeId, workflow: "builder", event: "autonomy.queue.available", payload: { ...payload } });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(repairs).toBe(1);
      expect(existsSync(join(scopeRoot, "data/tasks/archive/task-project.md"))).toBe(true);
      expect(readFileSync(join(scopeRoot, "result.txt"), "utf8")).toBe("ready");
      expect(git(scopeRoot, "status", "--porcelain")).toBe("");
      expect(existsSync(join(scopeRoot, "package.json"))).toBe(false);
      expect(existsSync(workspace)).toBe(false);
      expect(host.runState.listRuns(scopeId).every((run) => run.state === "succeeded")).toBe(true);
    } finally { await host.stop(); }
  }
  expect(launches.some((cwd) => cwd.startsWith(scopeRoots[0]!))).toBe(true);
  expect(launches.some((cwd) => cwd.startsWith(scopeRoots[1]!))).toBe(true);
});
