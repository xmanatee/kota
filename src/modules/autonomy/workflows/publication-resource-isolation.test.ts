import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type {
  WorkflowDefinitionInput,
  WorkflowResourceInput,
} from "#core/workflow/types.js";
import healthPublication from "./autonomy-health-review-publication/workflow.js";
import improverPublication from "./improver-disposition-publication/workflow.js";
import progressPublication from "./progress-review-publication/workflow.js";
import scopePublication from "./scope-improvement-publication/workflow.js";

const roots: string[] = [];

function resources(
  definition: WorkflowDefinitionInput,
  scopeRoot: string,
): readonly string[] {
  const input: WorkflowResourceInput = {
    scopeRoot,
    stateDir: join(scopeRoot, ".kota"),
    workflowName: definition.name,
    trigger: { event: "publication.requested", schemaRef: null, payload: {} },
  };
  return definition.resources?.(input) ?? [];
}

function admit(
  store: RunStateDatabase,
  definition: WorkflowDefinitionInput,
  scopeId: string,
  scopeRoot: string,
  runId: string,
): void {
  store.admitRun({
    id: runId,
    scopeId,
    workflow: definition.name,
    repository: "none",
    trigger: { event: "publication.requested", schemaRef: null, payload: {} },
    resources: resources(definition, scopeRoot),
    admittedAt: "2026-08-25T10:00:00.000Z",
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("autonomy publication resource isolation", () => {
  it("queues same-domain writers without blocking unrelated domains or scopes", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-publication-resources-"));
    roots.push(root);
    const scopeA = join(root, "scope-a");
    const scopeB = join(root, "scope-b");
    const store = new RunStateDatabase(join(root, "state"));
    store.registerScope({
      id: "scope-a",
      rootPath: scopeA,
      createdAt: "2026-08-25T09:00:00.000Z",
    });
    store.registerScope({
      id: "scope-b",
      rootPath: scopeB,
      createdAt: "2026-08-25T09:00:00.000Z",
    });
    const { epoch } = store.beginDaemonSession("2026-08-25T09:30:00.000Z");

    admit(store, healthPublication, "scope-a", scopeA, "health-a");
    expect(store.startRun("health-a", epoch, "2026-08-25T10:00:01.000Z")).toBe(1);
    admit(store, improverPublication, "scope-a", scopeA, "improver-a");
    expect(store.startRun("improver-a", epoch, "2026-08-25T10:00:01.000Z")).toBeNull();
    admit(store, progressPublication, "scope-a", scopeA, "progress-a");
    expect(store.startRun("progress-a", epoch, "2026-08-25T10:00:01.000Z")).toBe(1);
    admit(store, progressPublication, "scope-a", scopeA, "progress-a-2");
    expect(store.startRun("progress-a-2", epoch, "2026-08-25T10:00:01.000Z")).toBeNull();
    admit(store, scopePublication, "scope-a", scopeA, "scope-a");
    expect(store.startRun("scope-a", epoch, "2026-08-25T10:00:01.000Z")).toBe(1);

    admit(store, improverPublication, "scope-b", scopeB, "improver-b");
    expect(store.startRun("improver-b", epoch, "2026-08-25T10:00:01.000Z")).toBe(1);
    expect(store.getRun("health-a")?.resources).toHaveLength(1);
    expect(store.getRun("progress-a")?.resources).toHaveLength(1);
    expect(store.getRun("scope-a")?.resources).toHaveLength(1);
    expect(store.getRun("improver-b")?.resources).toHaveLength(1);
    store.close();
  });
});
