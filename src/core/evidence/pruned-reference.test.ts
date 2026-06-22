import { describe, expect, it } from "vitest";
import type { EvidencePrunedReference } from "./policy.js";
import { validateEvidencePrunedReference } from "./pruned-reference.js";

const validRunReference: EvidencePrunedReference = {
  artifactType: "workflow-run",
  id: "builder-run",
  prunedAt: "2026-06-04T12:00:00.000Z",
  retained: {
    id: "builder-run",
    workflow: "builder",
    status: "success",
    startedAt: "2026-06-04T11:55:00.000Z",
    completedAt: "2026-06-04T11:56:00.000Z",
  },
  provenance: {
    workflowName: "builder",
    runId: "builder-run",
    sourceEventIds: ["evtj-builder"],
    transformedFrom: [{ artifactType: "event-envelope", id: "evtj-builder" }],
  },
  payloadExpired: true,
};

const validEventReference: EvidencePrunedReference = {
  artifactType: "event-envelope",
  id: "evtj-1",
  prunedAt: "2026-06-04T12:00:00.000Z",
  retained: {
    id: "evtj-1",
    event: "workflow.completed",
    state: "active",
    receivedAt: "2026-06-04T11:55:00.000Z",
    journaledAt: "2026-06-04T11:55:01.000Z",
    scopeKind: "scope",
    scopeId: "scope-a",
    projectId: "scope-a",
    lineage: ["global", "scope-a"],
  },
  provenance: {
    workflowName: "builder",
    runId: "builder-run",
    sourceEventIds: ["evtj-parent"],
    transformedFrom: [{ artifactType: "event-envelope", id: "evtj-parent" }],
  },
  payloadExpired: true,
};

describe("validateEvidencePrunedReference", () => {
  it("accepts consistent workflow-run retained metadata and provenance", () => {
    expect(validateEvidencePrunedReference(validRunReference, {
      artifactType: "workflow-run",
      id: "builder-run",
      retainedKeys: ["id", "workflow", "status", "startedAt"],
      retainedValues: [
        { key: "workflow", value: "builder" },
        { key: "status", value: "success" },
      ],
      retainedDateTimeKeys: ["startedAt", "completedAt"],
      provenance: { workflowName: "builder", runId: "builder-run" },
    })).toEqual({ ok: true, reference: validRunReference });
  });

  it("rejects spoofed retained ids and provenance ids", () => {
    expect(validateEvidencePrunedReference({
      ...validRunReference,
      retained: { ...validRunReference.retained, id: "different-run" },
    }, {
      artifactType: "workflow-run",
      id: "builder-run",
      retainedKeys: ["id", "workflow", "status", "startedAt"],
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("retained.id"),
    });

    expect(validateEvidencePrunedReference({
      ...validRunReference,
      provenance: { ...validRunReference.provenance, runId: "different-run" },
    }, {
      artifactType: "workflow-run",
      id: "builder-run",
      retainedKeys: ["id", "workflow", "status", "startedAt"],
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("provenance.runId"),
    });
  });

  it("rejects event-envelope retained state and scope mismatches", () => {
    expect(validateEvidencePrunedReference({
      ...validEventReference,
      retained: { ...validEventReference.retained, state: "terminal" },
    }, {
      artifactType: "event-envelope",
      id: "evtj-1",
      retainedKeys: ["id", "event", "state", "receivedAt", "journaledAt"],
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("retained.state"),
    });

    expect(validateEvidencePrunedReference({
      ...validEventReference,
      retained: { ...validEventReference.retained, projectId: "scope-b" },
    }, {
      artifactType: "event-envelope",
      id: "evtj-1",
      retainedKeys: ["id", "event", "state", "receivedAt", "journaledAt"],
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("retained.projectId"),
    });
  });
});
