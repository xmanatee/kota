import { createHash } from "node:crypto";
import {
  type AutonomyHealthEvidenceRef,
  type AutonomyHealthJsonObject,
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
} from "#modules/autonomy/health-signal.js";

function stableJson(value: AutonomyHealthJsonValue | undefined): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isAutonomyHealthJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function autonomyHealthEvidenceFingerprint(
  dedupeKey: string,
  refs: readonly AutonomyHealthEvidenceRef[],
): string {
  return createHash("sha256")
    .update(stableJson({ dedupeKey, refs } as AutonomyHealthJsonObject))
    .digest("hex")
    .slice(0, 16);
}
