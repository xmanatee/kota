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
  projectDir: string,
): readonly string[] {
  const input: WorkflowResourceInput = {
    projectDir,
    stateDir: join(projectDir, ".kota"),
    workflowName: definition.name,
    trigger: { event: "publication.requested", schemaRef: null, payload: {} },
  };
  return definition.resources?.(input) ?? [];
}

function admit(
  store: RunStateDatabase,
  definition: WorkflowDefinitionInput,
  projectId: string,
  projectDir: string,
  runId: string,
): void {
  store.admitRun({
    id: runId,
    projectId,
    workflow: definition.name,
    repository: "none",
    trigger: { event: "publication.requested", schemaRef: null, payload: {} },
    resources: resources(definition, projectDir),
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
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    const store = new RunStateDatabase(join(root, "state"));
    store.registerProject({
      id: "project-a",
      rootPath: projectA,
      createdAt: "2026-08-25T09:00:00.000Z",
    });
    store.registerProject({
      id: "project-b",
      rootPath: projectB,
      createdAt: "2026-08-25T09:00:00.000Z",
    });
    const { epoch } = store.beginDaemonSession("2026-08-25T09:30:00.000Z");

    admit(store, healthPublication, "project-a", projectA, "health-a");
    expect(store.startRun("health-a", epoch, "2026-08-25T10:00:01.000Z")).toBe(1);
    admit(store, improverPublication, "project-a", projectA, "improver-a");
    expect(store.startRun("improver-a", epoch, "2026-08-25T10:00:01.000Z")).toBeNull();
    admit(store, progressPublication, "project-a", projectA, "progress-a");
    expect(store.startRun("progress-a", epoch, "2026-08-25T10:00:01.000Z")).toBe(1);
    admit(store, progressPublication, "project-a", projectA, "progress-a-2");
    expect(store.startRun("progress-a-2", epoch, "2026-08-25T10:00:01.000Z")).toBeNull();
    admit(store, scopePublication, "project-a", projectA, "scope-a");
    expect(store.startRun("scope-a", epoch, "2026-08-25T10:00:01.000Z")).toBe(1);

    admit(store, improverPublication, "project-b", projectB, "improver-b");
    expect(store.startRun("improver-b", epoch, "2026-08-25T10:00:01.000Z")).toBe(1);
    expect(store.getRun("health-a")?.resources).toHaveLength(1);
    expect(store.getRun("progress-a")?.resources).toHaveLength(1);
    expect(store.getRun("scope-a")?.resources).toHaveLength(1);
    expect(store.getRun("improver-b")?.resources).toHaveLength(1);
    store.close();
  });
});
