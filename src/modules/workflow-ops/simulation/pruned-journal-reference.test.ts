import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventJournal } from "#core/events/event-journal.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { simulateAutomation } from "./engine.js";
import { formatWorkflowSimulationResult } from "./format.js";

function projectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-simulation-pruned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return dir;
}

function workflow(
  name: string,
  overrides: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  return {
    name,
    enabled: true,
    moduleRoot: "/tmp/kota-simulation",
    definitionPath: `/tmp/kota-simulation/${name}.ts`,
    recoveryCapable: false,
    tags: [],
    triggers: [],
    steps: [],
    ...overrides,
  };
}

const bookingWorkflow = workflow("booking-workflow", {
  triggers: [{ event: "booking.requested", cooldownMs: 0 }],
  steps: [{ id: "book", type: "tool", tool: "book_court" }],
});

describe("workflow automation simulation pruned journal references", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports policy-pruned journal references without replaying unavailable payloads", async () => {
    dir = projectDir();
    const journal = new EventJournal(join(dir, ".kota", "events"), {
      now: () => new Date("2026-06-05T12:00:00.000Z"),
      retention: { kind: "expire-after-ms", durationMs: 1 },
      scopeLineage: (scopeId) => ["global", scopeId],
    });
    const envelope = journal.appendFromBusEnvelope({
      type: "booking.requested",
      schemaRef: { name: "booking.requested", version: 1 },
      payload: {
        scopeId: "scope-a",
        projectId: "scope-a",
        requestedBy: "operator",
        workflow: "booking-workflow",
        runId: "booking-run",
        receivedAt: "2026-06-05T12:00:00.000Z",
        rawPayload: { prompt: "do not replay" },
      },
    });

    const replayed = await simulateAutomation({
      projectDir: dir,
      definitions: [bookingWorkflow],
      request: {
        journal: {
          id: envelope.id,
        },
      },
    });

    expect(replayed.inputs).toHaveLength(1);
    expect(replayed.inputs[0]).toMatchObject({
      source: { kind: "journal", journalId: envelope.id },
      event: "booking.requested",
      eventId: envelope.id,
      outcome: "would-noop",
      dryRuns: [],
      availability: {
        kind: "policy-pruned",
        reasonCode: "policy-pruned-payload",
        artifactType: "event-envelope",
        id: envelope.id,
        retained: expect.objectContaining({
          scopeId: "scope-a",
          event: "booking.requested",
          state: "active",
          receivedAt: "2026-06-05T12:00:00.000Z",
        }),
        provenance: expect.objectContaining({
          workflowName: "booking-workflow",
          runId: "booking-run",
        }),
      },
    });
    expect(replayed.inputs[0]?.reasons).toContainEqual(
      expect.objectContaining({ code: "policy-pruned-payload" }),
    );

    const formatted = formatWorkflowSimulationResult(replayed);
    expect(formatted).toContain("Availability: policy-pruned policy-pruned-payload");
    expect(formatted).toContain(`artifact=event-envelope:${envelope.id}`);
    expect(JSON.stringify(replayed)).not.toContain("do not replay");
  });
});
