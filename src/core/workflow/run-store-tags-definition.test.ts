import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

const minimalWorkflow: WorkflowDefinition = {
  name: "builder",
  description: "test",
  enabled: true,
  repository: "read",
  tags: [],
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  moduleRoot: "/test-module-root",
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [],
};

describe("WorkflowRunStore workflow definition tags", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-tags-definition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(workspaceRoot, ".kota", "runs"), { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("persists workflow definition tags in metadata.json", () => {
    const trigger = {
      event: "manual",
      schemaRef: null,
      payload: { triggeredAt: new Date().toISOString() },
    };
    const handle = store.createRun({
      ...minimalWorkflow,
      tags: ["monitored"],
    }, trigger);

    expect(store.getRun(handle.metadata.id)?.tags).toEqual(["monitored"]);
  });

  it("merges workflow definition tags with trigger payload tags", () => {
    const trigger = {
      event: "manual",
      schemaRef: null,
      payload: {
        triggeredAt: new Date().toISOString(),
        tags: ["debug", "monitored"],
      },
    };
    const handle = store.createRun({
      ...minimalWorkflow,
      tags: ["monitored"],
    }, trigger);

    expect(store.getRun(handle.metadata.id)?.tags).toEqual([
      "monitored",
      "debug",
    ]);
  });
});
