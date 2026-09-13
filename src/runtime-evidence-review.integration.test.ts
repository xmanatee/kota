import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { expect, test } from "vitest";
import { clearAgentHarnessRegistryForTest, registerAgentHarness, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { buildNativeCliEnvironment } from "#core/agent-harness/native-cli-environment.js";
import { isNativeCliSandboxBootstrapError, withNativeCliSandbox } from "#core/agent-harness/native-cli-sandbox.js";
import { agentHarnessToolExecutionOptions } from "#core/agent-harness/tool-execution-options.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { registerTool } from "#core/tools/index.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { type LinkedRunArtifact, resolveRunArtifactHandoff, retainRunArtifacts } from "#core/workflow/run-artifact-handoff.js";
import { RunLifecycle } from "#core/workflow/run-lifecycle.js";
import { RunResourceAllocator } from "#core/workflow/run-resources.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { createStepContext } from "#core/workflow/steps/step-context.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { builderRepairChecks } from "#modules/autonomy/workflows/builder/repair-checks.js";
import { listBuilderTaskDispatches } from "#modules/autonomy/workflows/builder/task-contract.js";
import filesystemModule from "#modules/filesystem/index.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function write(root: string, ref: string, content: string): void {
  const path = join(root, ref);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// Detects the composition failure where a deny-all critic receives artifact paths
// but cannot read them, and where publication/cleanup destroys the reviewed proof.
test.for(["kota", "native"])("builder reviews unpublished evidence with %s isolation and publishes only repository changes", async (mode, { skip }) => {
  const root = mkdtempSync(join(tmpdir(), "kota-evidence-review-"));
  const crossScope = mkdtempSync(join(tmpdir(), "kota-other-scope-"));
  let database: RunStateDatabase | undefined;
  let nativeUnavailable: string | undefined;
  const disposeFilesystemTools: Array<() => void> = [];
  const selected: LinkedRunArtifact[] = [];
  const harnessName = "evidence-review-native";
  try {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.name", "KOTA Test");
    git(root, "config", "user.email", "kota@example.test");
    git(root, "config", "commit.gpgsign", "false");
    write(root, ".gitignore", ".kota/\n");
    write(root, "package.json", JSON.stringify({ name: "evidence-review-fixture", packageManager: "pnpm@10.32.1" }));
    write(root, ".kota/runtime/earlier/artifacts/selection.txt", "packet approved earlier");
    const earlier = retainRunArtifacts({ scopeRoot: root, runId: "run-earlier", roots: [{ name: "artifacts", path: join(root, ".kota/runtime/earlier/artifacts") }] });
    write(crossScope, ".kota/runtime/foreign/artifacts/secret.txt", "foreign packet");
    const foreign = retainRunArtifacts({ scopeRoot: crossScope, runId: "run-foreign", roots: [{ name: "artifacts", path: join(crossScope, ".kota/runtime/foreign/artifacts") }] });
    const task = `---\nstatus: open\npriority: p1\n---\n# Review evidence\n\nShow report output, response and packet input.\n${earlier.manifestRef}\n${foreign.manifestRef}\n`;
    write(root, "data/tasks/task-evidence.md", task);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "initial task");
    const base = git(root, "rev-parse", "HEAD");
    const dispatch = listBuilderTaskDispatches(root)[0]!;
    const trigger = { event: "autonomy.queue.available", schemaRef: null, payload: { ...dispatch } };
    write(crossScope, "private.txt", "other scope");
    write(crossScope, "private.py", "def private_value(): pass\n");
    database = new RunStateDatabase(join(root, ".kota/state"));
    const db = database;
    db.registerScope({ id: "scope-evidence", rootPath: root, createdAt: new Date().toISOString() });
    const { epoch } = db.beginDaemonSession(new Date().toISOString());
    db.admitRun({ id: "run-evidence", scopeId: "scope-evidence", workflow: "builder", repository: "write", trigger, resources: ["task:task-evidence"], admittedAt: new Date().toISOString() });
    db.registerScope({ id: "scope-foreign", rootPath: crossScope, createdAt: new Date().toISOString() });
    for (const [id, scopeId] of [["run-earlier", "scope-evidence"], ["run-foreign", "scope-foreign"]] as const) {
      db.admitRun({ id, scopeId, workflow: "earlier", repository: "none", trigger: { event: "manual", schemaRef: null, payload: {} }, resources: [], admittedAt: new Date().toISOString() });
    }
    db.startRun("run-evidence", epoch, new Date().toISOString());
    const filesystemTools = filesystemModule.tools;
    if (!Array.isArray(filesystemTools)) throw new Error("Expected static filesystem tools");
    for (const toolName of ["file_read", "glob", "repo_map"]) {
      const definition = filesystemTools.find((candidate) => candidate.tool.name === toolName);
      if (!definition) throw new Error(`Expected ${toolName} definition`);
      disposeFilesystemTools.push(registerTool(
        definition.tool,
        definition.runner,
        filesystemModule.name,
        definition,
      ));
    }
    registerAgentHarness({
      name: harnessName,
      description: "Controlled evidence reviewer",
      toolControl: mode === "kota" ? "kota" : "native",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: "ask_owner",
      emitsAgentMessageStream: false,
      ...(mode === "native" ? { nativeAbortQuarantine: "confirmed-stop" as const } : {}),
      run: async () => { throw new Error("Expected step-context runner"); },
    });
    let removedRuntime = "";
    const lifecycle = new RunLifecycle({
      store: db, daemonEpoch: epoch,
      continueIntegration: async () => undefined,
      validate: async context => {
        expect(readFileSync(join(context.sandbox.workspaceDir, "report.txt"), "utf8")).toBe("report ready\n");
        return { status: "passed", evidence: ["report output verified"] };
      },
      createResourceAllocator: store => new RunResourceAllocator(store, { portStart: 41000, portEnd: 41003, portRangeSize: 4, isPortAvailable: async () => true }),
      executeWorkflow: async (runContext, run) => {
        const workspaceRoot = runContext.sandbox.workspaceDir;
        removedRuntime = runContext.sandbox.rootDir;
        const agentRunDir = runContext.resources.agentDir;
        const artifactRoot = runContext.sandbox.artifactDir;
        write(agentRunDir, "transcript.txt", "Operator: report\nKOTA: ready\n");
        write(artifactRoot, "response.json", JSON.stringify({ result: "report ready", password: "private-secret", thinking: "undisclosed-analysis-words" }));
        write(artifactRoot, "packet/input.ts", "export const route = 'capable';\n");
        write(workspaceRoot, "report.txt", "report ready\n");
        rmSync(join(workspaceRoot, dispatch.taskPath));
        write(workspaceRoot, "data/tasks/archive/task-evidence.md", task.replace("status: open", "status: done"));
        const bus = new EventBus();
        const context = createStepContext({ id: run.id, workflow: "builder", definitionPath: "workflow.ts", trigger, startedAt: new Date().toISOString(), status: "running", runDir: `.kota/runs/${run.id}`, steps: [] }, trigger, undefined, {}, {}, [], {
          workspaceRoot, scopeRoot: root, runContext, bus, pbus: new ScopedEventBus(bus, run.scopeId), store: new WorkflowRunStore(root), readRuntimeState: readEmptyTestWorkflowRuntimeState,
          runtimeResources: { profileId: "review", env: {}, agentRunDir, artifactRoot },
          currentStepId: "build",
          runAgentHarness: async (_harness, options) => {
            expect(options.agentWriteScope).toBe("deny-all");
            const paths = options.readOnlyHostRoots ?? [];
            expect(paths.some(path => path.includes("run-foreign"))).toBe(false);
            const manifestPath = paths.find(path => path.includes("/manifests/"));
            if (!manifestPath) throw new Error("No runtime manifest grant");
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
            selected.push({ runId: run.id, manifestSha256: manifestPath.split("/").at(-1)!.replace(".json", "") });
            expect(manifest.sourceRevision).toBe(base);
            if (mode === "kota") {
              expect(options.agentReadScope).toEqual([
                workspaceRoot,
                ...paths,
              ]);
              const toolOptions = agentHarnessToolExecutionOptions(options, {
                resultLimit: 1_000_000,
              });
              const readable = [...paths.filter((path) => path.endsWith(".jsonl")), join(workspaceRoot, "report.txt")];
              const denied = [
                join(agentRunDir, "transcript.txt"),
                join(crossScope, "private.txt"),
                join(root, manifest.entries[0].originalRef),
              ];
              const results = await executeToolCalls(
                [...readable, ...denied].map((path, index) => ({
                  type: "tool_use" as const,
                  id: `read-${index}`,
                  name: "file_read",
                  input: { path },
                })),
                toolOptions,
              );
              const visibleText = results.slice(0, readable.length)
                .map((result) => result.content)
                .join("\n");
              for (const value of ["Operator: report", "report ready", "export const route", "packet approved earlier"]) {
                expect(visibleText).toContain(value);
              }
              for (const result of results.slice(readable.length)) {
                expect(result).toMatchObject({
                  is_error: true,
                  content: expect.stringContaining("outside the declared read roots"),
                });
              }
              const escapingPattern = `${relative(workspaceRoot, crossScope)}/**/*.py`;
              const escapeResults = await executeToolCalls(
                [
                  {
                    type: "tool_use",
                    id: "glob-escape",
                    name: "glob",
                    input: { path: workspaceRoot, pattern: escapingPattern },
                  },
                  {
                    type: "tool_use",
                    id: "repo-map-escape",
                    name: "repo_map",
                    input: { directory: workspaceRoot, pattern: escapingPattern },
                  },
                ],
                toolOptions,
              );
              for (const result of escapeResults) {
                expect(result).toMatchObject({
                  is_error: true,
                  content: expect.stringContaining("require complete targets"),
                });
                expect(result.content).not.toContain("private_value");
              }
              expect(visibleText).not.toContain("private-secret");
              expect(visibleText).not.toContain("undisclosed-analysis-words");
              return {
                text: JSON.stringify({ verdict: "pass", critical_issues: [], warnings: [], summary: "Read transcript, response and packet input." }),
                streamedText: "",
                turns: 1,
                isError: false,
                usage: UNKNOWN_AGENT_USAGE,
              };
            }
            const script = `
              const fs = require('node:fs');
              const assert = require('node:assert/strict');
              const paths = ${JSON.stringify(paths)};
              const text = paths.filter(p => p.endsWith('.jsonl')).map(p => fs.readFileSync(p, 'utf8')).join('\\n');
              for (const value of ['Operator: report', 'report ready', "export const route", 'packet approved earlier']) assert.ok(text.includes(value), value);
              for (const value of ['private-secret', 'undisclosed-analysis-words']) assert.ok(!text.includes(value), value);
              let denied = 0;
              for (const path of ${JSON.stringify([join(agentRunDir, "transcript.txt"), join(crossScope, "private.txt"), join(root, manifest.entries[0].originalRef)])}) {
                try { fs.readFileSync(path); } catch { denied++; }
              }
              for (const path of [paths[0], ${JSON.stringify(join(workspaceRoot, "report.txt"))}]) {
                try { fs.writeFileSync(path, 'corrupt'); } catch { denied++; }
              }
              assert.equal(denied, 5);
              console.log(JSON.stringify({ verdict: 'pass', critical_issues: [], warnings: [], summary: 'Read transcript, response and packet input.' }));
            `;
            const result = await withNativeCliSandbox(process.execPath, ["-e", script], { cwd: workspaceRoot, scopeRoot: root, runtimeStateRoot: join(root, ".kota"), machineAuthorityOwner: "kota", writableRoots: [], readOnlyHostRoots: paths, env: buildNativeCliEnvironment() }, sandboxed => Promise.resolve(spawnSync(sandboxed.command, sandboxed.args, { cwd: workspaceRoot, env: sandboxed.env, encoding: "utf8" })));
            if (isNativeCliSandboxBootstrapError(result.stderr)) {
              nativeUnavailable = result.stderr;
              throw new Error("Native sandbox unavailable");
            }
            expect(result.status, result.stderr).toBe(0);
            return { text: result.stdout, streamedText: "", turns: 1, isError: false, usage: UNKNOWN_AGENT_USAGE };
          },
        });
        const step: WorkflowAgentStep = { id: "build", type: "agent", harness: harnessName, model: "controlled", effort: "low", autonomyMode: "autonomous", promptPath: "unused.md", moduleRoot: root };
        for (const check of builderRepairChecks()) {
          if (check.type !== "code") throw new Error("Expected builder code check");
          await check.run(context, step);
        }
        return { kind: "completed", commitMessage: "Publish reviewed report" };
      },
    });
    const outcome = await lifecycle.execute(db.getRun("run-evidence")!, new AbortController().signal);
    if (nativeUnavailable) skip(`Native sandbox unavailable: ${nativeUnavailable}`);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "terminal", state: "succeeded" });
    expect(existsSync(removedRuntime)).toBe(false);
    expect(git(root, "diff", "--no-renames", "--name-only", base)).toBe("data/tasks/archive/task-evidence.md\ndata/tasks/task-evidence.md\nreport.txt");
    expect(selected).toHaveLength(1);
    const afterCleanup = resolveRunArtifactHandoff(root, selected[0]!);
    expect(afterCleanup.readOnlyPaths.every(path => existsSync(path))).toBe(true);
    expect(readFileSync(join(root, ".kota/runs/run-evidence/evidence-references.md"), "utf8")).toContain("originalSha256");
  } finally {
    for (const dispose of disposeFilesystemTools.reverse()) dispose();
    clearAgentHarnessRegistryForTest();
    database?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(crossScope, { recursive: true, force: true });
  }
});
