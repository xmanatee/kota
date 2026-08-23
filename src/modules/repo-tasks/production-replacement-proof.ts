import { isAbsolute } from "node:path";
import { extractRepoTaskSection } from "./repo-task-sections.js";

export const PRODUCTION_REPLACEMENT_SECTION = "Production Replacement Proof";

const REQUIRED_SCALAR_FIELDS = [
  "oldBoundary",
  "replacementOwner",
  "observableEffect",
  "retiredPathCheck",
  "evidenceArtifact",
] as const;
const REQUIRED_LIST_FIELDS = [
  "liveIngresses",
  "restartIngresses",
  "productionEntrypoints",
  "productionTests",
] as const;
const ALLOWED_FIELDS = new Set<string>([
  ...REQUIRED_SCALAR_FIELDS,
  ...REQUIRED_LIST_FIELDS,
]);
const REPO_TEST_PATH_RE = /^(?:src|clients)\/.+\.(?:integration\.)?test\.[a-z0-9]+$/i;
const PRODUCTION_ENTRYPOINT_PATH_RE = /^(?:src|clients)\/.+\.[cm]?[jt]sx?$/i;
const DURABLE_EVIDENCE_ARTIFACT_RE =
  /^\.kota\/runs\/[A-Za-z0-9][A-Za-z0-9._-]*\/evidence\/artifacts\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.json$/i;

export type ProductionReplacementDeclaration = {
  oldBoundary: string;
  replacementOwner: string;
  liveIngresses: string[];
  restartIngresses: string[];
  observableEffect: string;
  productionEntrypoints: string[];
  productionTests: string[];
  retiredPathCheck: string;
  evidenceArtifact: string;
};

export type ProductionReplacementDeclarationResult =
  | { kind: "absent" }
  | { kind: "invalid"; error: string }
  | { kind: "valid"; declaration: ProductionReplacementDeclaration };

function stripFence(section: string): string {
  const match = section.match(/^\s*```(?:ya?ml)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1] : section;
}

function splitList(value: string): string[] {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function hasUnsafeRepoPath(path: string): boolean {
  if (path.length === 0 || isAbsolute(path) || path.includes("\\")) return true;
  const normalized = path.split("/");
  return normalized.some((part) => part === "" || part === "." || part === "..");
}

function validateDeclarationPaths(
  declaration: ProductionReplacementDeclaration,
): string | null {
  if (hasUnsafeRepoPath(declaration.evidenceArtifact)) {
    return "evidenceArtifact must be a normalized repo-relative path";
  }
  if (!DURABLE_EVIDENCE_ARTIFACT_RE.test(declaration.evidenceArtifact)) {
    return "evidenceArtifact must name a durable projected JSON artifact under " +
      ".kota/runs/<run-id>/evidence/artifacts/";
  }
  const duplicateTests = declaration.productionTests.filter(
    (path, index, paths) => paths.indexOf(path) !== index,
  );
  if (duplicateTests.length > 0) {
    return `productionTests repeats ${duplicateTests[0]}`;
  }
  for (const path of declaration.productionTests) {
    if (hasUnsafeRepoPath(path) || !REPO_TEST_PATH_RE.test(path)) {
      return `productionTests entry ${JSON.stringify(path)} must name a repo test under src/ or clients/`;
    }
  }
  const duplicateEntrypoints = declaration.productionEntrypoints.filter(
    (path, index, paths) => paths.indexOf(path) !== index,
  );
  if (duplicateEntrypoints.length > 0) {
    return `productionEntrypoints repeats ${duplicateEntrypoints[0]}`;
  }
  for (const path of declaration.productionEntrypoints) {
    if (
      hasUnsafeRepoPath(path) ||
      !PRODUCTION_ENTRYPOINT_PATH_RE.test(path) ||
      /(?:^|\.)test\.[cm]?[jt]sx?$/i.test(path)
    ) {
      return `productionEntrypoints entry ${JSON.stringify(path)} must name non-test production source under src/ or clients/`;
    }
  }
  return null;
}

export function parseProductionReplacementDeclaration(
  raw: string,
): ProductionReplacementDeclarationResult {
  const section = extractRepoTaskSection(raw, PRODUCTION_REPLACEMENT_SECTION);
  if (section === null) return { kind: "absent" };

  const fields = new Map<string, string>();
  for (const line of stripFence(section).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/.exec(trimmed);
    if (!match) {
      return {
        kind: "invalid",
        error: `line must be "key: value": ${trimmed}`,
      };
    }
    const key = match[1];
    const value = match[2].trim();
    if (!ALLOWED_FIELDS.has(key)) {
      return { kind: "invalid", error: `unknown field ${JSON.stringify(key)}` };
    }
    if (fields.has(key)) {
      return { kind: "invalid", error: `field ${JSON.stringify(key)} is declared more than once` };
    }
    fields.set(key, value);
  }

  for (const field of [...REQUIRED_SCALAR_FIELDS, ...REQUIRED_LIST_FIELDS]) {
    if (!fields.has(field)) {
      return { kind: "invalid", error: `missing required field ${JSON.stringify(field)}` };
    }
  }

  const declaration: ProductionReplacementDeclaration = {
    oldBoundary: fields.get("oldBoundary")!,
    replacementOwner: fields.get("replacementOwner")!,
    liveIngresses: splitList(fields.get("liveIngresses")!),
    restartIngresses: splitList(fields.get("restartIngresses")!),
    observableEffect: fields.get("observableEffect")!,
    productionEntrypoints: splitList(fields.get("productionEntrypoints")!),
    productionTests: splitList(fields.get("productionTests")!),
    retiredPathCheck: fields.get("retiredPathCheck")!,
    evidenceArtifact: fields.get("evidenceArtifact")!,
  };
  for (const field of REQUIRED_LIST_FIELDS) {
    if (declaration[field].length === 0) {
      return { kind: "invalid", error: `${field} must contain at least one value` };
    }
  }
  const pathError = validateDeclarationPaths(declaration);
  if (pathError !== null) return { kind: "invalid", error: pathError };
  return { kind: "valid", declaration };
}
