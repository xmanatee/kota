import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";

export const BUILDER_EVIDENCE_MANIFEST_FILE = "evidence-manifest.json";
export const BUILDER_EVIDENCE_MAX_FILES = 32;
export const BUILDER_EVIDENCE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const BUILDER_EVIDENCE_MAX_TOTAL_BYTES = 24 * 1024 * 1024;

export const BUILDER_EVIDENCE_ARTIFACT_KINDS = [
  "text",
  "markdown",
  "html",
  "json",
  "jsonl",
  "png",
] as const;

export type BuilderEvidenceArtifactKind =
  (typeof BUILDER_EVIDENCE_ARTIFACT_KINDS)[number];

export type BuilderEvidenceRegistration = {
  path: string;
  kind: BuilderEvidenceArtifactKind;
};

function fail(message: string): never {
  throw new Error(`Builder evidence manifest: ${message}`);
}

function isJsonObject(value: KotaJsonValue): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function initializeBuilderEvidenceManifest(agentRunDir: string): void {
  const path = join(agentRunDir, BUILDER_EVIDENCE_MANIFEST_FILE);
  if (existsSync(path)) return;
  writeFileSync(
    path,
    `${JSON.stringify({ schemaVersion: 1, artifacts: [] }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function validateRegisteredPath(path: string): void {
  const parts = path.split("/");
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    parts.some((part) => part.length === 0 || part === "." || part === "..") ||
    parts.length > 6
  ) {
    fail(`artifact path is unsafe: ${path}`);
  }
}

export function parseBuilderEvidenceManifest(
  content: Buffer,
): BuilderEvidenceRegistration[] {
  if (content.length > BUILDER_EVIDENCE_MAX_FILE_BYTES) {
    fail(`${BUILDER_EVIDENCE_MANIFEST_FILE} exceeds the per-file limit`);
  }
  let parsed: KotaJsonValue;
  try {
    parsed = JSON.parse(content.toString("utf8")) as KotaJsonValue;
  } catch (error) {
    fail(`${BUILDER_EVIDENCE_MANIFEST_FILE} is malformed: ${String(error)}`);
  }
  if (!isJsonObject(parsed) || parsed.schemaVersion !== 1) {
    fail(`${BUILDER_EVIDENCE_MANIFEST_FILE} must declare schemaVersion 1`);
  }
  if (!Array.isArray(parsed.artifacts)) {
    fail(`${BUILDER_EVIDENCE_MANIFEST_FILE} artifacts must be an array`);
  }

  const registrations: BuilderEvidenceRegistration[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.artifacts) {
    if (!isJsonObject(raw)) fail("artifacts must be objects");
    const pathValue = raw.path;
    const kindValue = raw.kind;
    if (
      typeof pathValue !== "string" ||
      pathValue.length === 0 ||
      pathValue.trim() !== pathValue
    ) {
      fail("artifact paths must be non-empty trimmed strings");
    }
    if (
      typeof kindValue !== "string" ||
      !BUILDER_EVIDENCE_ARTIFACT_KINDS.includes(
        kindValue as BuilderEvidenceArtifactKind,
      )
    ) {
      fail(`artifact "${pathValue}" has an unsupported kind`);
    }
    validateRegisteredPath(pathValue);
    if (seen.has(pathValue)) fail(`artifact path is duplicated: ${pathValue}`);
    seen.add(pathValue);
    registrations.push({
      path: pathValue,
      kind: kindValue as BuilderEvidenceArtifactKind,
    });
  }
  return registrations;
}
