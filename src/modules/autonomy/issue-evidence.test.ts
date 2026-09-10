import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { StoredRun } from "#core/workflow/run-state-database.js";
import { writeIssueEvidence } from "./issue-evidence.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each(["file-link", "directory-link", "sandbox-link", "hard-link", "regular"] as const)(
  "exports retained critic evidence only through confined regular files: %s",
  (kind) => {
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
    const run: StoredRun = {
      id: "retained", scopeId: "scope", workflow: "builder", repository: "write",
      state: "needs_attention", resources: ["task:task-held"], attempt: 1, processes: [],
      admittedAt: "2026-09-10T00:00:00Z", trigger: { event: "manual", schemaRef: null, payload: {} },
      sandbox: { runId: "retained", repository: "write", rootDir: sandbox,
        workspaceDir: join(root, "missing-workspace"), tempDir: join(sandbox, "tmp"), artifactDir: join(sandbox, "artifacts"),
        baseCommit: "base", branch: "writer", targetBranch: "main" },
    };
    const path = writeIssueEvidence({
      stateDir: join(root, "state"), scopeId: "scope", scopeRoot: root,
      runEvidence: { getRun: (id) => id === run.id ? run : null, listRuns: () => [run] },
      workflow: { name: "improver", runId: "review", runDir: "review", runDirPath: join(root, "review"), definitionPath: "workflow.ts" },
    }, [{ kind: "run", ref: ".kota/runs/retained" }]);
    expect(path).not.toBeNull();
    const exported = readFileSync(path!, "utf8");
    expect(exported).not.toContain(secret.summary);
    if (kind === "regular") expect(exported).toContain("incomplete implementation");
    else expect(exported).toContain("Scoped evidence identity or content could not be verified");
  },
);
