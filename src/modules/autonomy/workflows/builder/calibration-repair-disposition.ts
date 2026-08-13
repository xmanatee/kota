import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import { showTask } from "#modules/repo-tasks/repo-tasks-operations.js";

const DISPOSITION = "follow-up-task";
const ACCEPTED_TRADEOFF = "low-sample-overlap";

function fail(message: string): never {
  throw new Error(`Calibration repair evidence ${message}`);
}

function objectField(
  value: KotaJsonValue | undefined,
  label: string,
): KotaJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`must contain object field ${label}.`);
  }
  return value;
}

function stringField(object: KotaJsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`must contain non-empty string field ${key}.`);
  }
  return value;
}

function hasProtocolLine(content: string, key: string, value: string | number): boolean {
  return content.split(/\r?\n/).includes(`${key}: ${value}`);
}

/** Require a durable disposition for every weak-evidence signal in the source aggregate. */
export function verifyCalibrationWeakEvidenceDisposition(args: {
  projectDir: string;
  artifact: KotaJsonObject;
  sourceRef: string;
  weakEvidenceCount: number;
}): number {
  if (args.weakEvidenceCount <= 0) return 0;
  const disposition = objectField(
    args.artifact.weakEvidenceDisposition,
    "weakEvidenceDisposition",
  );
  if (stringField(disposition, "resolution") !== DISPOSITION) {
    fail(`weakEvidenceDisposition.resolution must equal ${DISPOSITION}.`);
  }
  if (stringField(disposition, "sourceRef") !== args.sourceRef) {
    fail("weakEvidenceDisposition.sourceRef must match sourceSnapshot.sourceRef.");
  }
  if (disposition.weakEvidenceCount !== args.weakEvidenceCount) {
    fail(
      `weakEvidenceDisposition.weakEvidenceCount must equal ${args.weakEvidenceCount}.`,
    );
  }
  if (stringField(disposition, "rationale").length < 80) {
    fail("weakEvidenceDisposition.rationale must be substantive.");
  }

  const ids = disposition.followUpTaskIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === "string") ||
    new Set(ids).size !== ids.length
  ) {
    fail("weakEvidenceDisposition.followUpTaskIds must name distinct task ids.");
  }
  for (const id of ids) {
    const task = showTask(args.projectDir, id);
    if (!task.found || task.state === "done" || task.state === "dropped") {
      fail(`follow-up task ${id} must exist in an open task state.`);
    }
    if (
      !hasProtocolLine(task.content, "sourceRef", args.sourceRef) ||
      !hasProtocolLine(
        task.content,
        "weakEvidenceCount",
        args.weakEvidenceCount,
      ) ||
      !hasProtocolLine(task.content, "acceptedTradeoff", ACCEPTED_TRADEOFF)
    ) {
      fail(`follow-up task ${id} must bind the accepted source aggregate.`);
    }
  }
  return ids.length;
}
