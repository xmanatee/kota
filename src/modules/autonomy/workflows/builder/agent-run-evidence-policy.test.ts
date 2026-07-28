import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { checkAgentRunArtifactsReady } from "./agent-run-artifacts.js";
import {
  BUILDER_EVIDENCE_MANIFEST_FILE,
  BUILDER_EVIDENCE_MAX_FILE_BYTES,
  BUILDER_EVIDENCE_MAX_FILES,
  BUILDER_EVIDENCE_MAX_TOTAL_BYTES,
} from "./agent-run-evidence-manifest.js";
import { inspectBuilderEvidence } from "./agent-run-evidence-policy.js";

const tempDirs: string[] = [];

function makeRun(runId: string): { agentRunDir: string; workspaceDir: string } {
  const workspaceDir = mkdtempSync(join(tmpdir(), "kota-evidence-policy-"));
  tempDirs.push(workspaceDir);
  const agentRunDir = join(workspaceDir, ".kota", "builder-evidence", runId);
  mkdirSync(agentRunDir, { recursive: true });
  writeFileSync(join(agentRunDir, "success-criteria.txt"), "1. First\n2. Second\n");
  writeFileSync(
    join(agentRunDir, "success-criteria-verified.txt"),
    "1. First verified\n2. Second verified\n",
  );
  writeFileSync(join(agentRunDir, "commit-message.txt"), "Builder: test\n");
  writeManifest(agentRunDir);
  return { agentRunDir, workspaceDir };
}

function writeManifest(
  agentRunDir: string,
  artifacts: Array<{ path: string; kind: string }> = [],
): void {
  writeFileSync(
    join(agentRunDir, BUILDER_EVIDENCE_MANIFEST_FILE),
    `${JSON.stringify({ schemaVersion: 1, artifacts }, null, 2)}\n`,
  );
}

function artifactRoot(agentRunDir: string): string {
  const root = join(agentRunDir, "artifacts");
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("builder evidence policy", () => {
  it("rejects registered text that still contains credential material", () => {
    const { agentRunDir, workspaceDir } = makeRun("run-secret");
    const artifacts = artifactRoot(agentRunDir);
    writeFileSync(
      join(artifacts, "transcript.txt"),
      "api_key=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    );
    writeManifest(agentRunDir, [{ path: "transcript.txt", kind: "text" }]);

    expect(() => checkAgentRunArtifactsReady(agentRunDir, workspaceDir)).toThrow(
      /must be redacted before registration/,
    );

    writeFileSync(
      join(artifacts, "result.json"),
      `${JSON.stringify({ result: "sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })}\n`,
    );
    writeManifest(agentRunDir, [{ path: "result.json", kind: "json" }]);
    expect(() => checkAgentRunArtifactsReady(agentRunDir, workspaceDir)).toThrow(
      /must be redacted before registration/,
    );
  });

  it("projects screened JSON values instead of bytes containing shadowed sensitive keys", () => {
    const { agentRunDir, workspaceDir } = makeRun("run-shadowed-json");
    const artifacts = artifactRoot(agentRunDir);
    writeFileSync(
      join(artifacts, "result.json"),
      '{"apiKey":"shadowed-json-value","apiKey":"[redacted]","result":"safe"}\n',
    );
    writeFileSync(
      join(artifacts, "events.jsonl"),
      [
        '{"token":"shadowed-jsonl-value","token":"[redacted]","event":"safe"}',
        '{"event":"also-safe"}',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(agentRunDir, BUILDER_EVIDENCE_MANIFEST_FILE),
      [
        "{",
        '  "apiKey": "shadowed-manifest-value",',
        '  "apiKey": "[redacted]",',
        '  "schemaVersion": 1,',
        '  "artifacts": [',
        '    { "path": "result.json", "kind": "json" },',
        '    { "path": "events.jsonl", "kind": "jsonl" }',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );

    const evidence = inspectBuilderEvidence(agentRunDir, workspaceDir);
    const projected = new Map(
      evidence.files.map((file) => [
        file.relativeEvidencePath,
        file.projectedContent.toString("utf8"),
      ]),
    );

    expect(projected.get(BUILDER_EVIDENCE_MANIFEST_FILE)).toBe(
      '{"apiKey":"[redacted]","schemaVersion":1,"artifacts":[{"path":"result.json","kind":"json"},{"path":"events.jsonl","kind":"jsonl"}]}\n',
    );
    expect(projected.get("artifacts/result.json")).toBe(
      '{"apiKey":"[redacted]","result":"safe"}\n',
    );
    expect(projected.get("artifacts/events.jsonl")).toBe(
      '{"token":"[redacted]","event":"safe"}\n{"event":"also-safe"}\n',
    );
    expect([...projected.values()].join("\n")).not.toContain("shadowed-");
  });

  it("rejects opaque binary containers before compressed credentials can be staged", () => {
    const { agentRunDir, workspaceDir } = makeRun("run-archive");
    const artifacts = artifactRoot(agentRunDir);
    const compressedCredential = deflateRawSync(
      Buffer.from("OPENAI_API_KEY=sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"),
    );
    writeFileSync(
      join(artifacts, "trace.zip"),
      Buffer.concat([Buffer.from("504b0304", "hex"), compressedCredential]),
    );
    writeManifest(agentRunDir, [{ path: "trace.zip", kind: "zip" }]);
    expect(() => checkAgentRunArtifactsReady(agentRunDir, workspaceDir)).toThrow(
      /artifact "trace\.zip" has an unsupported kind/,
    );

    for (const [path, kind] of [
      ["screenshot.jpg", "jpeg"],
      ["capture.webm", "webm"],
      ["capture.mp4", "mp4"],
    ] as const) {
      writeManifest(agentRunDir, [{ path, kind }]);
      expect(() => checkAgentRunArtifactsReady(agentRunDir, workspaceDir)).toThrow(
        new RegExp(`artifact "${path.replace(".", "\\.")}" has an unsupported kind`),
      );
    }
  });

  it("rejects traversal registrations and linked evidence directories", () => {
    const traversal = makeRun("run-traversal");
    writeManifest(traversal.agentRunDir, [
      { path: "../credentials.txt", kind: "text" },
    ]);
    expect(() =>
      checkAgentRunArtifactsReady(traversal.agentRunDir, traversal.workspaceDir),
    ).toThrow(/artifact path is unsafe/);

    const linked = makeRun("run-linked");
    const externalArtifacts = join(linked.workspaceDir, "external-artifacts");
    mkdirSync(externalArtifacts);
    writeFileSync(join(externalArtifacts, "validation.txt"), "safe\n");
    symlinkSync(externalArtifacts, join(linked.agentRunDir, "artifacts"));
    writeManifest(linked.agentRunDir, [{ path: "validation.txt", kind: "text" }]);
    expect(() =>
      checkAgentRunArtifactsReady(linked.agentRunDir, linked.workspaceDir),
    ).toThrow(/evidence directory must be a real directory/);
  });

  it("enforces per-file, file-count, and total-size bounds", () => {
    const oversized = makeRun("run-oversized");
    writeFileSync(
      join(artifactRoot(oversized.agentRunDir), "oversized.txt"),
      Buffer.alloc(BUILDER_EVIDENCE_MAX_FILE_BYTES + 1, "a"),
    );
    writeManifest(oversized.agentRunDir, [
      { path: "oversized.txt", kind: "text" },
    ]);
    expect(() =>
      checkAgentRunArtifactsReady(oversized.agentRunDir, oversized.workspaceDir),
    ).toThrow(/exceeds the per-file limit/);

    const crowded = makeRun("run-crowded");
    const crowdedArtifacts = artifactRoot(crowded.agentRunDir);
    const registrations: Array<{ path: string; kind: string }> = [];
    for (let index = 0; index < BUILDER_EVIDENCE_MAX_FILES; index += 1) {
      const path = `evidence-${index}.txt`;
      writeFileSync(join(crowdedArtifacts, path), "safe\n");
      registrations.push({ path, kind: "text" });
    }
    writeManifest(crowded.agentRunDir, registrations);
    expect(() =>
      checkAgentRunArtifactsReady(crowded.agentRunDir, crowded.workspaceDir),
    ).toThrow(/exceeds the file-count limit/);

    const total = makeRun("run-total");
    const totalArtifacts = artifactRoot(total.agentRunDir);
    const totalRegistrations: Array<{
      path: string;
      kind: string;
    }> = [];
    const fileBytes = Math.floor(BUILDER_EVIDENCE_MAX_TOTAL_BYTES / 3);
    for (let index = 0; index < 4; index += 1) {
      const path = `total-${index}.txt`;
      writeFileSync(join(totalArtifacts, path), Buffer.alloc(fileBytes, "a"));
      totalRegistrations.push({ path, kind: "text" });
    }
    writeManifest(total.agentRunDir, totalRegistrations);
    expect(() =>
      checkAgentRunArtifactsReady(total.agentRunDir, total.workspaceDir),
    ).toThrow(/exceed the total-size limit/);
  });
});
