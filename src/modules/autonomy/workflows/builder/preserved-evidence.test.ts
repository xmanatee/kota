import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkAgentRunArtifactsReady,
  commitBuilderWorkflowChanges,
} from "./agent-run-artifacts.js";
import { findPreservedBuilderEvidenceRunId } from "./preserved-evidence.js";

const tempDirs: string[] = [];

function makeWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "kota-preserved-evidence-"));
  tempDirs.push(workspace);
  return workspace;
}

function evidenceDir(workspace: string, runId: string): string {
  return join(workspace, ".kota", "builder-evidence", runId);
}

function writeIncompleteEvidence(workspace: string, runId: string): string {
  const source = evidenceDir(workspace, runId);
  mkdirSync(source, { recursive: true });
  writeFileSync(
    join(source, "success-criteria.txt"),
    "1. Complete the task\n",
    "utf8",
  );
  writeFileSync(
    join(source, "evidence-manifest.json"),
    '{"schemaVersion":1,"artifacts":[]}\n',
    "utf8",
  );
  return source;
}

function finishEvidence(source: string): void {
  writeFileSync(
    join(source, "success-criteria-verified.txt"),
    "1. Verified task completion\n",
    "utf8",
  );
  writeFileSync(
    join(source, "commit-message.txt"),
    "Complete preserved work\n",
    "utf8",
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("preserved builder evidence", () => {
  it("accepts screened continuation evidence before completion artifacts exist", () => {
    const workspace = makeWorkspace();
    const source = writeIncompleteEvidence(workspace, "builder-original");

    expect(findPreservedBuilderEvidenceRunId(workspace, "builder-original")).toBe(
      "builder-original",
    );
    expect(() => checkAgentRunArtifactsReady(source, workspace)).toThrow(
      /Builder evidence filesystem operation failed \(ENOENT\)/,
    );
    expect(() => commitBuilderWorkflowChanges(workspace, source)).toThrow(
      /Builder evidence filesystem operation failed \(ENOENT\)/,
    );

    finishEvidence(source);
    expect(checkAgentRunArtifactsReady(source, workspace)).toMatch(/^OK: 4 /);
  });

  it("uses the requested preserved lineage even when canonical evidence also exists", () => {
    const workspace = makeWorkspace();
    writeIncompleteEvidence(workspace, "builder-original");
    finishEvidence(writeIncompleteEvidence(workspace, "canonical-builder-one"));
    finishEvidence(writeIncompleteEvidence(workspace, "canonical-builder-two"));

    expect(findPreservedBuilderEvidenceRunId(workspace, "builder-original")).toBe(
      "builder-original",
    );
  });

  it("rejects missing, malformed, and escaped manifests", () => {
    const workspace = makeWorkspace();
    const missing = writeIncompleteEvidence(workspace, "missing-manifest");
    rmSync(join(missing, "evidence-manifest.json"));
    expect(() =>
      findPreservedBuilderEvidenceRunId(workspace, "missing-manifest"),
    ).toThrow(/Builder evidence filesystem operation failed \(ENOENT\)/);

    const malformed = writeIncompleteEvidence(workspace, "malformed-manifest");
    writeFileSync(join(malformed, "evidence-manifest.json"), "not json\n");
    expect(() =>
      findPreservedBuilderEvidenceRunId(workspace, "malformed-manifest"),
    ).toThrow(/evidence-manifest\.json is malformed/);

    const escaped = writeIncompleteEvidence(workspace, "escaped-manifest");
    writeFileSync(
      join(escaped, "evidence-manifest.json"),
      '{"schemaVersion":1,"artifacts":[{"path":"../outside.txt","kind":"text"}]}\n',
    );
    expect(() =>
      findPreservedBuilderEvidenceRunId(workspace, "escaped-manifest"),
    ).toThrow(/artifact path is unsafe/);
    expect(() =>
      findPreservedBuilderEvidenceRunId(workspace, "../escaped-run"),
    ).toThrow(/run directory must be \.kota\/builder-evidence/);
  });

  it("rejects symbolic-link evidence roots and registered artifacts", () => {
    const workspace = makeWorkspace();
    const realSource = writeIncompleteEvidence(workspace, "real-source");
    symlinkSync(realSource, evidenceDir(workspace, "linked-source"));
    expect(() =>
      findPreservedBuilderEvidenceRunId(workspace, "linked-source"),
    ).toThrow(/run evidence path must be a real directory/);

    const linkedArtifact = writeIncompleteEvidence(workspace, "linked-artifact");
    const artifactRoot = join(linkedArtifact, "artifacts");
    mkdirSync(artifactRoot);
    const outside = join(workspace, "outside.txt");
    writeFileSync(outside, "safe\n");
    symlinkSync(outside, join(artifactRoot, "result.txt"));
    writeFileSync(
      join(linkedArtifact, "evidence-manifest.json"),
      '{"schemaVersion":1,"artifacts":[{"path":"result.txt","kind":"text"}]}\n',
    );
    expect(() =>
      findPreservedBuilderEvidenceRunId(workspace, "linked-artifact"),
    ).toThrow(/Builder evidence filesystem operation failed/);
  });

  it.each([
    "success-criteria-verified.txt",
    "commit-message.txt",
  ])(
    "rejects a dangling symbolic link at optional continuation path %s",
    (fileName) => {
      const workspace = makeWorkspace();
      const source = writeIncompleteEvidence(workspace, `dangling-${fileName}`);
      symlinkSync(join(workspace, "missing-target"), join(source, fileName));

      expect(() =>
        findPreservedBuilderEvidenceRunId(workspace, `dangling-${fileName}`),
      ).toThrow(/Builder evidence filesystem operation failed/);
    },
  );
});
