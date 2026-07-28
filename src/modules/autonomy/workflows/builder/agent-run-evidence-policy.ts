import { isUtf8 } from "node:buffer";
import {
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import {
  projectEvidenceJsonValue,
  redactSensitiveText,
} from "#core/evidence/policy.js";
import type { EvidenceJsonValue } from "#core/evidence/policy-model.js";
import { validateOutboundGitHubCommentBody } from "#modules/autonomy/github-comment-safety.js";
import { readStableBuilderEvidenceFile } from "./agent-run-evidence-filesystem-helper.js";
import {
  BUILDER_EVIDENCE_MANIFEST_FILE,
  BUILDER_EVIDENCE_MAX_FILE_BYTES,
  BUILDER_EVIDENCE_MAX_FILES,
  BUILDER_EVIDENCE_MAX_TOTAL_BYTES,
  type BuilderEvidenceArtifactKind,
  type BuilderEvidenceRegistration,
  parseBuilderEvidenceManifest,
} from "./agent-run-evidence-manifest.js";
import { projectBuilderEvidencePng } from "./agent-run-evidence-png.js";
import { isBuilderPathInside } from "./workspace.js";

type BuilderEvidenceFile = BuilderEvidenceRegistration & {
  absolutePath: string;
  relativeEvidencePath: string;
};

export type BuilderEvidenceInspection = {
  fileCount: number;
  totalBytes: number;
  files: Array<
    Pick<BuilderEvidenceFile, "absolutePath" | "relativeEvidencePath"> & {
      projectedContent: Buffer;
    }
  >;
};

const ROOT_EVIDENCE_FILES: readonly (BuilderEvidenceRegistration & {
  required: boolean;
})[] = [
  { path: "success-criteria.txt", kind: "text", required: true },
  { path: "success-criteria-verified.txt", kind: "text", required: true },
  { path: "commit-message.txt", kind: "text", required: true },
  { path: BUILDER_EVIDENCE_MANIFEST_FILE, kind: "json", required: true },
  { path: "autonomy-change-decision.json", kind: "json", required: false },
  { path: "runtime-probe.json", kind: "json", required: false },
];

const KIND_EXTENSIONS: Readonly<
  Record<BuilderEvidenceArtifactKind, readonly string[]>
> = {
  text: [".txt", ".log"],
  markdown: [".md"],
  html: [".html"],
  json: [".json"],
  jsonl: [".jsonl"],
  png: [".png"],
};

function fail(message: string): never {
  throw new Error(`Builder evidence policy: ${message}`);
}

function assertRealDirectoryChain(root: string, target: string): void {
  let current = root;
  for (const part of relative(root, target).split(sep)) {
    current = join(current, part);
    const stats = lstatSync(current, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isDirectory() || stats.isSymbolicLink()) {
      fail(`evidence directory must be a real directory: ${current}`);
    }
  }
}

function assertExpectedExtension(file: BuilderEvidenceFile): void {
  if (!KIND_EXTENSIONS[file.kind].includes(extname(file.path))) {
    fail(`registered ${file.kind} artifact has an invalid extension: ${file.path}`);
  }
}

function screenedJsonValue(value: EvidenceJsonValue, path: string): EvidenceJsonValue {
  const projected = projectEvidenceJsonValue(
    value,
    "internal-storage",
  );
  if (JSON.stringify(projected) !== JSON.stringify(value)) {
    fail(`registered artifact must be redacted before registration: ${path}`);
  }
  return projected;
}

function serializeScreenedJson(values: readonly EvidenceJsonValue[]): Buffer {
  if (values.length === 0) return Buffer.alloc(0);
  return Buffer.from(
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8",
  );
}

function assertNoHighConfidenceCredential(text: string, path: string): void {
  const scan = validateOutboundGitHubCommentBody(text);
  if (scan.status === "suspect") {
    fail(`registered artifact must be redacted before registration: ${path} (${scan.secretClass})`);
  }
}

function assertTextIsScreened(text: string, path: string): void {
  if (redactSensitiveText(text) !== text) {
    fail(`registered artifact must be redacted before registration: ${path}`);
  }
  assertNoHighConfidenceCredential(text, path);
}

function projectTypedContent(file: BuilderEvidenceFile, content: Buffer): Buffer {
  const textKinds: readonly BuilderEvidenceArtifactKind[] = [
    "text", "markdown", "html", "json", "jsonl",
  ];
  if (textKinds.includes(file.kind)) {
    if (!isUtf8(content)) fail(`registered text artifact is not UTF-8: ${file.path}`);
    const text = content.toString("utf8");
    if (file.kind === "json" || file.kind === "jsonl") {
      assertNoHighConfidenceCredential(text, file.path);
      const lines = file.kind === "json" ? [text] : text.split("\n").filter((line) => line.trim());
      const projectedValues = lines.map((line, index) => {
        let value: EvidenceJsonValue;
        try {
          value = JSON.parse(line) as EvidenceJsonValue;
        } catch (error) {
          fail(`registered ${file.kind} artifact is malformed at item ${index + 1}: ${file.path} (${String(error)})`);
        }
        return screenedJsonValue(value, file.path);
      });
      return serializeScreenedJson(projectedValues);
    }
    assertTextIsScreened(text, file.path);
    return content;
  }

  if (file.kind === "png") {
    return projectBuilderEvidencePng(content, file.path);
  }
  return fail(`registered artifact has an unsupported kind: ${file.path}`);
}

function inspectFile(
  file: BuilderEvidenceFile,
  workspaceRoot: string,
  capturedContent?: Buffer,
): { projectedContent: Buffer; projectedSize: number } {
  assertExpectedExtension(file);
  const content = capturedContent ?? readStableBuilderEvidenceFile(
    workspaceRoot,
    file.absolutePath,
    BUILDER_EVIDENCE_MAX_FILE_BYTES,
  );
  const projectedContent = projectTypedContent(
    file,
    content,
  );
  if (projectedContent.length > BUILDER_EVIDENCE_MAX_FILE_BYTES) {
    fail(`projected artifact exceeds the per-file limit: ${file.path}`);
  }
  return {
    projectedContent,
    projectedSize: projectedContent.length,
  };
}

export function inspectBuilderEvidence(
  agentRunDir: string,
  workspaceDir: string,
): BuilderEvidenceInspection {
  const workspaceRoot = resolve(workspaceDir);
  const runRoot = resolve(agentRunDir);
  const runParts = relative(workspaceRoot, runRoot).split(sep);
  if (
    !isBuilderPathInside(workspaceRoot, runRoot) ||
    runParts.length !== 3 ||
    runParts[0] !== ".kota" ||
    runParts[1] !== "builder-evidence"
  ) {
    fail(`run directory must be .kota/builder-evidence/<run-id>: ${agentRunDir}`);
  }
  const runStats = lstatSync(runRoot, { throwIfNoEntry: false });
  if (runStats === undefined || !runStats.isDirectory() || runStats.isSymbolicLink()) {
    fail(`run evidence path must be a real directory: ${agentRunDir}`);
  }
  if (
    !isBuilderPathInside(
      realpathSync.native(workspaceRoot),
      realpathSync.native(runRoot),
    )
  ) {
    fail(`run evidence path escaped the workspace: ${agentRunDir}`);
  }
  assertRealDirectoryChain(workspaceRoot, runRoot);

  const artifactRoot = join(runRoot, "artifacts");
  const manifestPath = join(runRoot, BUILDER_EVIDENCE_MANIFEST_FILE);
  const manifestContent = readStableBuilderEvidenceFile(
    workspaceRoot,
    manifestPath,
    BUILDER_EVIDENCE_MAX_FILE_BYTES,
  );
  const registrations = parseBuilderEvidenceManifest(manifestContent);
  if (registrations.length > 0) {
    assertRealDirectoryChain(workspaceRoot, artifactRoot);
  }
  const files: BuilderEvidenceFile[] = [];
  for (const rootFile of ROOT_EVIDENCE_FILES) {
    const absolutePath = join(runRoot, rootFile.path);
    if (!rootFile.required && !existsSync(absolutePath)) continue;
    files.push({
      path: rootFile.path,
      kind: rootFile.kind,
      absolutePath,
      relativeEvidencePath: rootFile.path,
    });
  }
  for (const registration of registrations) {
    files.push({
      ...registration,
      absolutePath: join(artifactRoot, registration.path),
      relativeEvidencePath: join("artifacts", registration.path),
    });
  }
  if (files.length > BUILDER_EVIDENCE_MAX_FILES) {
    fail(`${files.length} registered files exceeds the file-count limit of ${BUILDER_EVIDENCE_MAX_FILES}`);
  }

  let totalBytes = 0;
  const inspectedFiles: BuilderEvidenceInspection["files"] = [];
  for (const file of files) {
    const inspection = inspectFile(
      file,
      workspaceRoot,
      file.absolutePath === manifestPath ? manifestContent : undefined,
    );
    totalBytes += inspection.projectedSize;
    if (totalBytes > BUILDER_EVIDENCE_MAX_TOTAL_BYTES) {
      fail(`registered artifacts exceed the total-size limit of ${BUILDER_EVIDENCE_MAX_TOTAL_BYTES} bytes`);
    }
    inspectedFiles.push({
      absolutePath: file.absolutePath,
      relativeEvidencePath: file.relativeEvidencePath,
      projectedContent: inspection.projectedContent,
    });
  }
  return {
    fileCount: files.length,
    totalBytes,
    files: inspectedFiles,
  };
}
