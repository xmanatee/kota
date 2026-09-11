import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectBlockedEvidence } from "./evidence.js";
import { recoveryEvidenceOutcomes } from "./evidence-relevance.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "blocked-evidence-"));
  roots.push(root);
  mkdirSync(join(root, ".kota/runs/result"), { recursive: true });
  mkdirSync(join(root, ".kota/eval-runs/evaluation"), { recursive: true });
  return root;
}

describe("scoped blocked evidence collection", () => {
  it("captures redacted content and alternate eval provenance without treating a file as acceptance", async () => {
    const root = fixture();
    const path = join(root, ".kota/eval-runs/evaluation/result.json");
    writeFileSync(path, JSON.stringify({ outcome: "fail", source: "fixture", authorization: "Bearer example-secret", thinking: "private trace" }));
    const first = await collectBlockedEvidence(root, ".kota/runs");
    expect(first.artifacts, JSON.stringify(first.unavailable)).toHaveLength(1);
    expect(first.artifacts[0]?.content.outcome).toBe("fail");
    expect(JSON.stringify(first)).not.toContain("example-secret");
    expect(JSON.stringify(first)).not.toContain("private trace");
    expect(await collectBlockedEvidence(root, ".kota/runs")).toEqual(first);
    expect((await collectBlockedEvidence(root, ".kota/eval-runs/eval*")).artifacts).toEqual(first.artifacts);
    writeFileSync(path, JSON.stringify({ outcome: "pass", source: "fixture" }));
    expect((await collectBlockedEvidence(root, ".kota/runs")).artifacts[0]?.digest).not.toBe(first.artifacts[0]?.digest);
  });

  it("discovers task-named exports without another task citation and still requires content attribution", async () => {
    const root = fixture();
    const task = { id: "task-target", body: "Requires execution evidence" };
    for (const id of [task.id, "task-other"]) {
      const directory = join(root, ".kota/eval-runs", id);
      mkdirSync(directory);
      writeFileSync(join(directory, "result.json"), JSON.stringify({ taskId: id,
        execution: { kind: "contained" }, exitCode: 0 }));
    }
    const selection = { task, runIds: [] };
    const collected = await collectBlockedEvidence(root, ".kota/runs", [], selection);
    expect(collected.artifacts.map((artifact) => artifact.path)).toEqual([".kota/eval-runs/task-target/result.json"]);
    expect(recoveryEvidenceOutcomes(collected, task)).toHaveLength(1);
    writeFileSync(join(root, ".kota/eval-runs/task-target/result.json"), JSON.stringify({
      taskId: "task-other", execution: { kind: "contained" }, exitCode: 0,
    }));
    expect(recoveryEvidenceOutcomes(await collectBlockedEvidence(root, ".kota/runs", [], selection), task)).toEqual([]);
  });

  it("refuses arbitrary host paths and linked evidence, and excludes the reviewer's own exports", async () => {
    const root = fixture();
    const secret = join(root, "sensitive.json");
    writeFileSync(secret, JSON.stringify({ private: "must not escape" }));
    symlinkSync(secret, join(root, ".kota/runs/result/link.json"));
    const blocked = await collectBlockedEvidence(root, ".kota/runs");
    expect(blocked.artifacts).toEqual([]);
    expect(blocked.unavailable).toContainEqual(expect.stringContaining("linked evidence"));
    expect((await collectBlockedEvidence(root, secret)).artifacts).toEqual([]);
    writeFileSync(join(root, ".kota/runs/result/self.json"), JSON.stringify({ outcome: "pass" }));
    expect((await collectBlockedEvidence(root, ".kota/runs", ["result"])).artifacts).toEqual([]);
    expect((await collectBlockedEvidence(root, ".kota/runs/result/self.json", ["result"])).artifacts).toEqual([]);
    const invalid = await collectBlockedEvidence(root, ".kota/runs", [], {
      task: { id: "task-target", body: "Evidence .kota/runs/result/.." },
      runIds: ["../../sensitive.json", "..", "."],
    });
    expect(invalid.artifacts).toEqual([]);
    expect(invalid.unavailable).toContainEqual(expect.stringContaining("Invalid task-linked run identity"));
  });
});
