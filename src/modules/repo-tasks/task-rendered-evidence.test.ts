import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRepoTaskStateTransitionBlocker } from "./repo-tasks-domain.js";
import {
  hasConcreteRenderedEvidence,
  hasConcreteRenderedEvidenceReference,
  hasNamedRenderedEvidence,
} from "./task-rendered-evidence.js";

function productClientTask(body: string) {
  return {
    id: "task-full-cli-evidence",
    title: "Replace bare kota with the full daemon-backed CLI client",
    area: "client",
    summary: "Replace the shallow navigator with the real operator CLI.",
    taskClass: "Product" as const,
    body,
  };
}

describe("rendered completion evidence", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-rendered-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("requires concrete local proof references and existing artifacts", () => {
    const concreteBody = [
      "## Acceptance Evidence",
      "",
      "- Full CLI transcript under `.kota/runs/2026-07-08T01-00-00-000Z-builder-test/transcript.txt`.",
    ].join("\n");
    const placeholderBody = [
      "## Acceptance Evidence",
      "",
      "- Full CLI transcript under `.kota/runs/<run-id>/transcript.txt`.",
    ].join("\n");

    expect(hasConcreteRenderedEvidenceReference(placeholderBody)).toBe(false);
    expect(hasConcreteRenderedEvidenceReference(concreteBody)).toBe(true);
    expect(hasConcreteRenderedEvidence(concreteBody, projectDir)).toBe(false);

    mkdirSync(join(projectDir, ".kota", "runs", "2026-07-08T01-00-00-000Z-builder-test"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".kota", "runs", "2026-07-08T01-00-00-000Z-builder-test", "transcript.txt"),
      "operator transcript\n",
    );

    expect(hasConcreteRenderedEvidence(concreteBody, projectDir)).toBe(true);
  });

  it("recognizes the documented Runtime Probe section as concrete runtime evidence", () => {
    const probeBody = [
      "## Acceptance Evidence",
      "",
      "- Runtime probe declared below.",
      "",
      "## Runtime Probe",
      "",
      "```",
      "command: pnpm test",
      "timeoutMs: 5000",
      "```",
    ].join("\n");

    expect(hasNamedRenderedEvidence(probeBody)).toBe(true);
    expect(hasConcreteRenderedEvidenceReference(probeBody)).toBe(true);
    expect(hasConcreteRenderedEvidence(probeBody, projectDir)).toBe(true);
  });

  it("blocks Product client completion when rendered evidence is placeholder-only", () => {
    const blocker = getRepoTaskStateTransitionBlocker(
      productClientTask([
        "## Acceptance Evidence",
        "",
        "- Full CLI transcript under `.kota/runs/<run-id>/transcript.txt`.",
      ].join("\n")),
      "done",
      projectDir,
    );

    expect(blocker).toMatch(/Placeholders/);
  });

  it("blocks Product client completion when rendered evidence artifacts are missing", () => {
    const blocker = getRepoTaskStateTransitionBlocker(
      productClientTask([
        "## Acceptance Evidence",
        "",
        "- Full CLI transcript under `.kota/runs/2026-07-08T00-00-00-000Z-builder-test/transcript.txt`.",
      ].join("\n")),
      "done",
      projectDir,
    );

    expect(blocker).toMatch(/artifacts must exist/);
  });
});
