import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunMetadataAuthorityError } from "./run-metadata.js";
import type { StoredRun } from "./run-state-types.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

const RUN_ID = "2026-09-03T08-00-00-000Z-builder-historical";
const STARTED_AT = "2026-09-03T08:00:00.000Z";
const TRIGGER = {
  event: "autonomy.queue.available",
  schemaRef: null,
  payload: { taskId: "task-historical" },
} as const;

function definition(scopeRoot: string): WorkflowDefinition {
  return {
    name: "builder",
    description: "test builder",
    enabled: true,
    repository: "write",
    tags: ["autonomy"],
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    moduleRoot: scopeRoot,
    triggers: [{ event: TRIGGER.event, cooldownMs: 0 }],
    steps: [{ id: "build", type: "code", run: () => undefined }],
    integration: { validationCommand: ["true"] },
  };
}

function durableRun(): StoredRun {
  return {
    id: RUN_ID,
    scopeId: "scope-a",
    workflow: "builder",
    trigger: { ...TRIGGER, payload: { ...TRIGGER.payload } },
    repository: "write",
    state: "needs_attention",
    resources: ["task:task-historical"],
    admittedAt: "2026-09-03T07:59:59.000Z",
    attempt: 1,
    startedAt: STARTED_AT,
    processes: [],
    wait: { reason: "daemon-restart-process-recovery" },
  };
}

describe("workflow run metadata authority repair", () => {
  let scopeRoot: string;
  let store: WorkflowRunStore;
  let metadataPath: string;
  let triggerPath: string;

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-run-metadata-repair-"));
    store = new WorkflowRunStore(scopeRoot);
    store.createRun(
      definition(scopeRoot),
      { ...TRIGGER, payload: { ...TRIGGER.payload } },
      RUN_ID,
    );
    metadataPath = join(store.runsDir, RUN_ID, "metadata.json");
    triggerPath = join(store.runsDir, RUN_ID, "trigger.json");
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("reconciles malformed authority from agreeing durable snapshots and retains the source", () => {
    const malformed = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<
      string,
      unknown
    >;
    malformed.id = "wrong-but-untrusted-metadata-id";
    malformed.workflow = 17;
    malformed.definitionPath = null;
    malformed.trigger = {
      event: TRIGGER.event,
      schemaRef: "legacy-invalid-reference",
      payload: { taskId: "task-historical" },
    };
    malformed.triggeredByRunId = "forged-triggering-run";
    malformed.causedBy = {
      runId: "forged-causing-run",
      workflow: "forged-workflow",
    };
    malformed.retryOf = "forged-retry-source";
    malformed.resumedFromRunId = "forged-resume-source";
    malformed.startedAt = "not-a-timestamp";
    const original = `${JSON.stringify(malformed, null, 2)}\n`;
    writeFileSync(metadataPath, original, "utf8");

    const repair = store.repairMetadataFromDurableAuthority(durableRun());

    expect(repair).toMatchObject({
      kind: "repaired",
      runId: RUN_ID,
      metadata: {
        metadataVersion: 1,
        id: RUN_ID,
        workflow: "builder",
        definitionPath:
          "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: TRIGGER,
        startedAt: STARTED_AT,
        status: "running",
        runDir: `.kota/runs/${RUN_ID}`,
      },
    });
    expect(repair.backupPath).toBeDefined();
    expect(existsSync(repair.backupPath!)).toBe(true);
    expect(readFileSync(repair.backupPath!, "utf8")).toBe(original);
    expect(store.getRun(RUN_ID, { authorityCritical: true })).toEqual(
      repair.metadata,
    );
    expect(repair.metadata).not.toHaveProperty("triggeredByRunId");
    expect(repair.metadata).not.toHaveProperty("causedBy");
    expect(repair.metadata).not.toHaveProperty("retryOf");
    expect(repair.metadata).not.toHaveProperty("resumedFromRunId");
    expect(repair.metadata.authorityRepair).toMatchObject({
      originalSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      repairedAt: expect.any(String),
    });
    const failure =
      `Workflow run metadata authority is invalid at ${metadataPath}: malformed`;
    expect(store.retainedMetadataAuthorityRepair(failure)).toEqual({
      runId: RUN_ID,
      repairedAt: repair.metadata.authorityRepair!.repairedAt,
    });
    expect(
      store.retainedMetadataAuthorityRepair(
        failure.replace(scopeRoot, `${scopeRoot}-other`),
      ),
    ).toBeNull();
  });

  it("keeps malformed metadata fail-closed when trigger authorities disagree", () => {
    const malformed = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<
      string,
      unknown
    >;
    malformed.definitionPath = 17;
    const original = `${JSON.stringify(malformed, null, 2)}\n`;
    writeFileSync(metadataPath, original, "utf8");
    writeFileSync(
      triggerPath,
      `${JSON.stringify({ ...TRIGGER, payload: { taskId: "other-task" } }, null, 2)}\n`,
      "utf8",
    );

    expect(() =>
      store.repairMetadataFromDurableAuthority(durableRun())
    ).toThrow(WorkflowRunMetadataAuthorityError);
    expect(() =>
      store.repairMetadataFromDurableAuthority(durableRun())
    ).toThrow("trigger.json does not agree");
    expect(readFileSync(metadataPath, "utf8")).toBe(original);
    expect(
      readdirSync(join(store.runsDir, RUN_ID)).some((name) =>
        name.startsWith("metadata.pre-authority-repair-")
      ),
    ).toBe(false);
  });

  it("does not reinterpret an unsupported metadata version", () => {
    const malformed = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<
      string,
      unknown
    >;
    malformed.metadataVersion = 2;
    writeFileSync(metadataPath, `${JSON.stringify(malformed, null, 2)}\n`, "utf8");

    expect(() =>
      store.repairMetadataFromDurableAuthority(durableRun())
    ).toThrow("unsupported metadataVersion 2 cannot be authority-repaired");
  });
});
