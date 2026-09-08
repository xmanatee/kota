import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import healthReviewer from "./autonomy-health-reviewer/workflow.js";
import improverPublication from "./improver-disposition-publication/workflow.js";
import progressPublication from "./progress-review-publication/workflow.js";
import scopePublication from "./scope-improvement-publication/workflow.js";

function resources(definition: WorkflowDefinitionInput, scopeRoot: string) {
  return definition.resources?.({
    scopeRoot,
    stateDir: join(scopeRoot, ".kota"),
    workflowName: definition.name,
    trigger: { event: "publication.requested", schemaRef: null, payload: {} },
  }) ?? [];
}

describe("autonomy publication resource binding", () => {
  it("shares issue ownership while separating review domains", () => {
    const health = resources(healthReviewer, "/scope-a");
    expect(health.length).toBeGreaterThan(0);
    expect(resources(improverPublication, "/scope-a")).toEqual(health);
    const progress = resources(progressPublication, "/scope-a");
    const scope = resources(scopePublication, "/scope-a");
    expect(progress.length).toBeGreaterThan(0);
    expect(scope.length).toBeGreaterThan(0);
    expect(new Set([...health, ...progress, ...scope]).size)
      .toBe(health.length + progress.length + scope.length);
  });
});
