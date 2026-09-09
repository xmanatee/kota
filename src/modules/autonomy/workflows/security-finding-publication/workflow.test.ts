import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { securityFindingPublicationRequested } from "../security-review/events.js";
import { SECURITY_REVIEW_RESOURCE } from "../security-review/review-state.js";
import { SecurityReviewProjectFixture } from "../security-review/workflow-test-fixture.js";
import workflow from "./workflow.js";

describe("security family publication admission", () => {
  let fixture: SecurityReviewProjectFixture;
  beforeEach(() => { fixture = new SecurityReviewProjectFixture(); });
  afterEach(() => fixture.cleanup());

  it("parks publication behind queued and retained task owners without changing their contract", () => {
    const scopeRoot = fixture.workspaceRoot;
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    const stateDir = join(scopeRoot, ".kota/authority");
    const db = new RunStateDatabase(stateDir);
    const taskId = "task-existing-repair";
    fixture.writeLegacySecurityFindingTask({ id: taskId, state: "open", runId: "old", claim: "Original admitted repair" });
    const taskPath = join(scopeRoot, `data/tasks/${taskId}.md`);
    const before = readFileSync(taskPath, "utf8");
    const trigger = { event: securityFindingPublicationRequested.name, schemaRef: null, payload: { taskId } };
    const input = { scopeRoot, scopeId, stateDir, workflowName: workflow.name, trigger,
      state: createTestTransactionalRunState(join(scopeRoot, ".kota/test-state"), scopeId),
    };
    try {
      db.registerScope({ id: scopeId, rootPath: scopeRoot, createdAt: new Date().toISOString() });
      expect(workflow.resources!(input)).toEqual([SECURITY_REVIEW_RESOURCE, `task:${taskId}`]);
      expect(workflow.triggerAdmission!(input)).toEqual({ admitted: true });
      db.admitRun({ id: "builder-owner", scopeId, workflow: "builder", repository: "write", resources: [`task:${taskId}`], trigger, admittedAt: new Date().toISOString() });
      expect(workflow.triggerAdmission!(input)).toMatchObject({ admitted: false });
      db.requireRunAttention("builder-owner", "retained writer requires recovery", []);
      expect(workflow.triggerAdmission!(input)).toMatchObject({ admitted: false });
      expect(readFileSync(taskPath, "utf8")).toBe(before);
    } finally { db.close(); }
  });
});
