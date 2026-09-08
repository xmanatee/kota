import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import type { DigestState } from "./aggregate.js";
import { DAILY_DIGEST_STATE_KEY } from "./on-demand.js";
import workflow, { DAILY_DIGEST_EVENT } from "./workflow.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("daily digest cadence publication", () => {
  it("publishes a quiet digest and advances the next queue delta from the completed snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "daily-digest-workflow-"));
    roots.push(root);
    mkdirSync(join(root, "data/tasks/archive"), { recursive: true });
    const state = createTestTransactionalRunState();
    const run = () => new WorkflowScenarioDriver(workflow, {
      workspaceRoot: root,
      workspaceDir: root,
      trigger: { event: "schedule", payload: {} },
      ports: { state },
    }).run();

    const first = await run();
    expect(first.status, first.error).toBe("success");
    expect(first.emitted).toEqual([expect.objectContaining({
      event: DAILY_DIGEST_EVENT,
      payload: expect.objectContaining({ quiet: true, text: expect.stringContaining("Daily digest") }),
    })]);
    expect(state.read<DigestState>(DAILY_DIGEST_STATE_KEY).value?.counts).toEqual({ open: 0, blocked: 0 });

    writeFileSync(join(root, "data/tasks/task-newcomer.md"),
      "---\nstatus: open\npriority: p2\n---\n\n# Newcomer\n");
    const second = await run();
    expect(second.status, second.error).toBe("success");
    expect(second.steps["build-digest"].output).toMatchObject({
      queueDelta: { previous: { open: 0, blocked: 0 }, delta: { open: 1, blocked: 0 } },
    });
    expect(state.read<DigestState>(DAILY_DIGEST_STATE_KEY).value?.counts).toEqual({ open: 1, blocked: 0 });
    expect(second.emitted).toEqual([expect.objectContaining({ event: DAILY_DIGEST_EVENT })]);
  });
});
