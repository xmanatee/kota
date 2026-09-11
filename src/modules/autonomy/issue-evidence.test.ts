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
