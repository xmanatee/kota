import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { writeIssueEvidence } from "./issue-evidence.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each(["file-link", "directory-link", "sandbox-link", "hard-link", "regular"] as const)(
  "exports retained critic evidence only through confined regular files: %s",
  async (kind) => {
    const root = mkdtempSync(join(tmpdir(), "issue-export-"));
    roots.push(root);
    const runtime = join(root, "runtime");
    const sandbox = join(runtime, "retained");
    const outside = join(root, "outside");
    mkdirSync(join(sandbox, "agent"), { recursive: true });
    mkdirSync(join(outside, "agent"), { recursive: true });
    const source = join(outside, "critic-review.json");
    const target = join(sandbox, "agent/critic-review.json");
    const secret = { summary: "outside-authorized-artifact-content" };
    writeFileSync(source, JSON.stringify(secret));
    writeFileSync(join(outside, "agent/critic-review.json"), JSON.stringify(secret));
    if (kind === "file-link") symlinkSync(source, target);
    else if (kind === "hard-link") linkSync(source, target);
    else if (kind === "directory-link") {
      rmSync(join(sandbox, "agent"), { recursive: true });
      symlinkSync(outside, join(sandbox, "agent"));
    } else if (kind === "sandbox-link") {
      rmSync(sandbox, { recursive: true });
      symlinkSync(outside, sandbox);
    } else writeFileSync(target, JSON.stringify({ verdict: "fail", summary: "incomplete implementation" }));
    const stateDir = join(root, "state");
    const database = new RunStateDatabase(stateDir);
    database.registerScope({ id: "scope", rootPath: root, createdAt: "2026-09-10T00:00:00Z" });
    database.admitRun({ id: "retained", scopeId: "scope", workflow: "builder", repository: "write",
      resources: ["task:task-held"], admittedAt: "2026-09-10T00:00:00Z",
      trigger: { event: "manual", schemaRef: null, payload: {} } });
    const { epoch } = database.beginDaemonSession("2026-09-10T00:00:01Z");
    database.startRun("retained", epoch, "2026-09-10T00:00:02Z");
    database.setSandbox("retained", epoch, { runId: "retained", repository: "write", rootDir: sandbox,
      workspaceDir: join(root, "missing-workspace"), tempDir: join(sandbox, "tmp"), artifactDir: join(sandbox, "artifacts"),
      baseCommit: "base", branch: "writer", targetBranch: "main" });
    database.suspendRun({ runId: "retained", epoch, state: "needs_attention",
      suspendedAt: "2026-09-10T00:00:03Z", wait: { reason: "review" } });
    database.close();
    const path = await writeIssueEvidence({
      stateDir, runtimeStateDir: stateDir, scopeId: "scope", scopeRoot: root,
      runBlocking: runWorkflowBlockingOperation,
      workflow: { name: "improver", runId: "review", runDir: "review", runDirPath: join(root, "review"), definitionPath: "workflow.ts" },
    }, [{ kind: "run", ref: ".kota/runs/retained" }]);
    expect(path).not.toBeNull();
    const exported = readFileSync(path!, "utf8");
    expect(exported).not.toContain(secret.summary);
    if (kind === "regular") expect(exported).toContain("incomplete implementation");
    else expect(exported).toContain("Critic review unavailable from anchored evidence");
  },
);

it("exports only cited same-scope diagnostic content, batches repeated log references, and reports unavailable inputs", async () => {
  const root = mkdtempSync(join(tmpdir(), "issue-content-"));
  roots.push(root);
  const stateDir = join(root, ".kota");
  const database = new RunStateDatabase(stateDir);
  database.registerScope({ id: "scope", rootPath: root, createdAt: "2026-09-12T00:00:00Z" });
  database.registerScope({ id: "other", rootPath: join(root, "other"), createdAt: "2026-09-12T00:00:00Z" });
  for (const [id, scopeId] of [["selected", "scope"], ["foreign", "other"]]) {
    database.admitRun({ id: id!, scopeId: scopeId!, workflow: "probe", repository: "none", resources: [],
      admittedAt: "2026-09-12T00:00:00Z", trigger: { event: "manual", schemaRef: null, payload: {} } });
    mkdirSync(join(stateDir, "runs", id!), { recursive: true });
    writeFileSync(join(stateDir, "runs", id!, "control-monitor-coverage.json"), JSON.stringify({
      scopeId, outcome: id === "selected" ? "control request timed out" : "foreign-private-content",
      authorization: "Bearer private-token", thinking: "private-reasoning-content",
    }));
  }
  database.close();
  const logs = join(stateDir, "modules/telegram/logs.jsonl");
  mkdirSync(join(stateDir, "modules/telegram"), { recursive: true });
  writeFileSync(logs, [
    { module: "telegram", msg: "unselected-line" },
    { module: "telegram", msg: "getUpdates conflict", data: { token: "private-token", operation: "poll" } },
  ].map((entry) => JSON.stringify(entry)).join("\n"));
  writeFileSync(join(stateDir, "secrets.json"), JSON.stringify({ value: "host-secret-content" }));
  symlinkSync(join(stateDir, "secrets.json"), join(stateDir, "runs/selected/linked.json"));
  writeFileSync(join(stateDir, "runs/selected/oversize.json"), JSON.stringify({ text: "x".repeat(128 * 1024) }));
  writeFileSync(join(stateDir, "runs/selected/invalid.json"), "host-secret-content is not JSON");
  const path = await writeIssueEvidence({ scopeRoot: root, scopeId: "scope", stateDir, runtimeStateDir: stateDir,
    runBlocking: runWorkflowBlockingOperation,
    runtimeResources: { profileId: "review", env: {}, agentRunDir: join(root, "sandbox/agent") },
    workflow: { name: "improver", runId: "review", runDir: ".kota/runs/review", runDirPath: join(stateDir, "runs/review"), definitionPath: "workflow.ts" },
  }, [
    { kind: "artifact", ref: ".kota/runs/selected/control-monitor-coverage.json" },
    { kind: "module-log", ref: ".kota/modules/telegram/logs.jsonl#L2" },
    ...[".kota/runs/foreign/control-monitor-coverage.json", ".kota/secrets.json", ".kota/runs/selected/../../secrets.json",
      ".kota/runs/selected/linked.json", ".kota/runs/selected/oversize.json", ".kota/runs/selected/invalid.json", ".kota/runs/selected/missing.json"].map((ref) => ({ kind: "artifact" as const, ref })),
    { kind: "module-log", ref: ".kota/modules/telegram/logs.jsonl#L99" },
  ]);
  expect(path).toBe(join(root, "sandbox/agent/issue-evidence.json"));
  const exported = readFileSync(path!, "utf8");
  expect(exported).toContain("control request timed out");
  expect(exported).toContain("getUpdates conflict");
  for (const denied of ["host-secret-content", "foreign-private-content", "private-token", "private-reasoning-content", "unselected-line"]) expect(exported).not.toContain(denied);
  const parsed = JSON.parse(exported);
  expect(parsed.evidence.filter((entry: { unavailable?: string }) => entry.unavailable)).toHaveLength(8);
  expect(parsed.evidence.filter((entry: { content?: object }) => entry.content)).toHaveLength(2);
  expect(readFileSync(join(stateDir, "runs/review/issue-evidence.json"), "utf8")).toBe(exported);
});
