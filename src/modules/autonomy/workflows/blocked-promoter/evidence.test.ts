import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectBlockedEvidence } from "./evidence.js";

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
  it("captures redacted content and alternate eval provenance without treating a file as acceptance", () => {
    const root = fixture();
    const path = join(root, ".kota/eval-runs/evaluation/result.json");
    writeFileSync(path, JSON.stringify({ outcome: "fail", source: "fixture", authorization: "Bearer example-secret", thinking: "private trace" }));
    const first = collectBlockedEvidence(root, ".kota/runs");
    expect(first.artifacts, JSON.stringify(first.unavailable)).toHaveLength(1);
    expect(first.artifacts[0]?.content.outcome).toBe("fail");
    expect(JSON.stringify(first)).not.toContain("example-secret");
    expect(JSON.stringify(first)).not.toContain("private trace");
    expect(collectBlockedEvidence(root, ".kota/runs")).toEqual(first);
    expect(collectBlockedEvidence(root, ".kota/eval-runs/eval*").artifacts).toEqual(first.artifacts);
    writeFileSync(path, JSON.stringify({ outcome: "pass", source: "fixture" }));
    expect(collectBlockedEvidence(root, ".kota/runs").artifacts[0]?.digest).not.toBe(first.artifacts[0]?.digest);
  });

  it("refuses arbitrary host paths and linked evidence, and excludes the reviewer's own exports", () => {
    const root = fixture();
    const secret = join(root, "sensitive.json");
    writeFileSync(secret, JSON.stringify({ private: "must not escape" }));
    symlinkSync(secret, join(root, ".kota/runs/result/link.json"));
    const blocked = collectBlockedEvidence(root, ".kota/runs");
    expect(blocked.artifacts).toEqual([]);
    expect(blocked.unavailable).toContainEqual(expect.stringContaining("linked evidence"));
    expect(collectBlockedEvidence(root, secret).artifacts).toEqual([]);
    writeFileSync(join(root, ".kota/runs/result/self.json"), JSON.stringify({ outcome: "pass" }));
    expect(collectBlockedEvidence(root, ".kota/runs", ["result"]).artifacts).toEqual([]);
  });
});
