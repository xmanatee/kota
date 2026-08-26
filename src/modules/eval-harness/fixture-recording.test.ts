import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FixtureRecordingProvenanceError,
  loadFixture,
} from "./fixture.js";
import {
  REAL_FAILURE_PROVENANCE,
  SMOKE_PROVENANCE,
  writeFixture,
} from "./fixture-test-support.js";

describe("agent-step recording provenance", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-fixture-recording-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeRecording(
    fixtureId: string,
    stepId: string,
    recording: Record<string, unknown>,
  ): void {
    const dir = join(root, fixtureId, "recordings");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${stepId}.json`),
      JSON.stringify(recording, null, 2),
    );
  }

  const VALID_RECORDING = {
    version: 2,
    workflowName: "decomposer",
    stepId: "decompose",
    sourceRunId: REAL_FAILURE_PROVENANCE.sourceRunId,
    response: {
      text: "ok",
      subtype: "success",
      turns: 1,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "unknown" },
      },
    },
    fileOperations: [],
  };

  it("attaches recordings to the loaded fixture", () => {
    writeFixture(root, "withRec", {
      id: "withRec",
      description: "rec",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
      provenance: REAL_FAILURE_PROVENANCE,
    });
    writeRecording("withRec", "decompose", VALID_RECORDING);

    const loaded = loadFixture(root, "withRec");
    expect(loaded.agentStepRecordings).toHaveLength(1);
    expect(loaded.agentStepRecordings[0].stepId).toBe("decompose");
  });

  it("rejects a recording whose sourceRunId does not match provenance", () => {
    writeFixture(root, "mismatched", {
      id: "mismatched",
      description: "rec",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
      provenance: REAL_FAILURE_PROVENANCE,
    });
    writeRecording("mismatched", "decompose", {
      ...VALID_RECORDING,
      sourceRunId: "2026-04-02T00-00-00-000Z-other",
    });

    let caught: unknown;
    try {
      loadFixture(root, "mismatched");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureRecordingProvenanceError);
    expect((caught as Error).message).toMatch(/sourceRunId/);
  });

  it("permits agent-step recordings on a smoke fixture for harness-plumbing fixtures with no real-run history", () => {
    // Some workflows (e.g. pr-reviewer) have no real-failure history yet, so
    // the harness-plumbing fixture that locks their replay path must use
    // smoke-fixture provenance. Honesty stays in the smoke justification,
    // not in a forced "real-failure" claim against a fabricated run id.
    writeFixture(root, "smokeWithRec", {
      id: "smokeWithRec",
      description: "rec",
      role: "pr-reviewer",
      workflowName: "pr-reviewer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
      provenance: SMOKE_PROVENANCE,
    });
    writeRecording("smokeWithRec", "decompose", {
      ...VALID_RECORDING,
      sourceRunId: "synthesized-fixture-2026-04-25",
    });

    const loaded = loadFixture(root, "smokeWithRec");
    expect(loaded.agentStepRecordings).toHaveLength(1);
    expect(loaded.agentStepRecordings[0].sourceRunId).toBe(
      "synthesized-fixture-2026-04-25",
    );
  });

  it("surfaces malformed recordings as a load-time error", () => {
    writeFixture(root, "malformed", {
      id: "malformed",
      description: "rec",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
      provenance: REAL_FAILURE_PROVENANCE,
    });
    writeRecording("malformed", "decompose", { version: 99 });

    expect(() => loadFixture(root, "malformed")).toThrow(/invalid agent-step recording/);
  });
});
