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

const PRODUCT_CLIENT_TASK_ID = "task-full-cli-evidence";

function productClientTask(body: string) {
  return {
    id: PRODUCT_CLIENT_TASK_ID,
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

    expect(hasConcreteRenderedEvidenceReference(placeholderBody, PRODUCT_CLIENT_TASK_ID)).toBe(false);
    expect(hasConcreteRenderedEvidenceReference(concreteBody, PRODUCT_CLIENT_TASK_ID)).toBe(true);
    expect(hasConcreteRenderedEvidence(concreteBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(false);

    mkdirSync(join(projectDir, ".kota", "runs", "2026-07-08T01-00-00-000Z-builder-test"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".kota", "runs", "2026-07-08T01-00-00-000Z-builder-test", "transcript.txt"),
      "operator transcript\n",
    );

    expect(hasConcreteRenderedEvidence(concreteBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(true);
  });

  it("rejects broad directory references with unrelated proof descendants", () => {
    mkdirSync(join(projectDir, ".kota", "runs", "some-other-run"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "runs", "some-other-run", "transcript.txt"),
      "unrelated transcript\n",
    );
    writeFileSync(join(projectDir, "transcript.txt"), "unrelated root transcript\n");
    mkdirSync(join(projectDir, "artifacts", "old-run"), { recursive: true });
    writeFileSync(
      join(projectDir, "artifacts", "old-run", "transcript.txt"),
      "unrelated artifact transcript\n",
    );

    const broadRunsBody = [
      "## Acceptance Evidence",
      "",
      "- Full CLI transcript under `.kota/runs/`.",
    ].join("\n");
    const projectRootBody = [
      "## Acceptance Evidence",
      "",
      "- Full CLI transcript under `./`.",
    ].join("\n");
    const genericArtifactsBody = [
      "## Acceptance Evidence",
      "",
      "- Full CLI transcript under `artifacts/`.",
    ].join("\n");

    expect(hasConcreteRenderedEvidenceReference(broadRunsBody, PRODUCT_CLIENT_TASK_ID)).toBe(false);
    expect(hasConcreteRenderedEvidence(broadRunsBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(false);
    expect(hasConcreteRenderedEvidenceReference(projectRootBody, PRODUCT_CLIENT_TASK_ID)).toBe(false);
    expect(hasConcreteRenderedEvidence(projectRootBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(false);
    expect(hasConcreteRenderedEvidenceReference(genericArtifactsBody, PRODUCT_CLIENT_TASK_ID)).toBe(false);
    expect(hasConcreteRenderedEvidence(genericArtifactsBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(false);
  });

  it("rejects run directory references that are not tied to the task", () => {
    const unrelatedRunBody = [
      "## Acceptance Evidence",
      "",
      "- Full CLI transcript under `.kota/runs/2026-07-08T01-00-00-000Z-builder-test/`.",
    ].join("\n");

    mkdirSync(join(projectDir, ".kota", "runs", "2026-07-08T01-00-00-000Z-builder-test"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".kota", "runs", "2026-07-08T01-00-00-000Z-builder-test", "transcript.txt"),
      "unrelated operator transcript\n",
    );

    expect(hasConcreteRenderedEvidenceReference(unrelatedRunBody, PRODUCT_CLIENT_TASK_ID)).toBe(false);
    expect(hasConcreteRenderedEvidence(unrelatedRunBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(false);
  });

  it("accepts narrowly scoped proof directories", () => {
    const runScopedBody = [
      "## Acceptance Evidence",
      "",
      "- Full CLI transcript under `.kota/runs/2026-07-08T01-00-00-000Z-builder-test/evidence/task-full-cli-evidence/`.",
    ].join("\n");
    const taskScopedBody = [
      "## Acceptance Evidence",
      "",
      "- Rendered fixture under `evidence/task-full-cli-evidence/`.",
    ].join("\n");

    const runTaskEvidenceDir = join(
      projectDir,
      ".kota",
      "runs",
      "2026-07-08T01-00-00-000Z-builder-test",
      "evidence",
      PRODUCT_CLIENT_TASK_ID,
    );
    mkdirSync(runTaskEvidenceDir, { recursive: true });
    writeFileSync(join(runTaskEvidenceDir, "logs.txt"), "ordinary log\n");
    writeFileSync(
      join(runTaskEvidenceDir, "transcript.txt"),
      "operator transcript\n",
    );
    mkdirSync(join(projectDir, "evidence", PRODUCT_CLIENT_TASK_ID), { recursive: true });
    writeFileSync(
      join(projectDir, "evidence", PRODUCT_CLIENT_TASK_ID, "rendered-fixture.json"),
      "{}\n",
    );

    expect(hasConcreteRenderedEvidenceReference(runScopedBody, PRODUCT_CLIENT_TASK_ID)).toBe(true);
    expect(hasConcreteRenderedEvidence(runScopedBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(true);
    expect(hasConcreteRenderedEvidenceReference(taskScopedBody, PRODUCT_CLIENT_TASK_ID)).toBe(true);
    expect(hasConcreteRenderedEvidence(taskScopedBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(true);
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
    expect(hasConcreteRenderedEvidenceReference(probeBody, PRODUCT_CLIENT_TASK_ID)).toBe(true);
    expect(hasConcreteRenderedEvidence(probeBody, projectDir, PRODUCT_CLIENT_TASK_ID)).toBe(true);
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

  it("blocks Product client completion when a run directory is not task-scoped", () => {
    mkdirSync(join(projectDir, ".kota", "runs", "2026-07-08T00-00-00-000Z-builder-test"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".kota", "runs", "2026-07-08T00-00-00-000Z-builder-test", "transcript.txt"),
      "unrelated operator transcript\n",
    );

    const blocker = getRepoTaskStateTransitionBlocker(
      productClientTask([
        "## Acceptance Evidence",
        "",
        "- Full CLI transcript under `.kota/runs/2026-07-08T00-00-00-000Z-builder-test/`.",
      ].join("\n")),
      "done",
      projectDir,
    );

    expect(blocker).toMatch(/scoped to task id task-full-cli-evidence/);
  });
});
