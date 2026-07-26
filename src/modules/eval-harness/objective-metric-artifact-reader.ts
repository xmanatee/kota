import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ObjectiveMetricValidationError } from "./objective-metrics-types.js";

const MAX_OBJECTIVE_METRIC_ARTIFACT_BYTES = 1024 * 1024;

type MetricArtifactContext = {
  workingDir: string;
  fixtureId: string;
  metricName: string;
  relativePath: string;
};

type NodeFileSystemError = Error & { code?: string };

function artifactError(
  context: MetricArtifactContext,
  reason: "missing-source" | "source-failed",
  detail: string,
): ObjectiveMetricValidationError {
  return new ObjectiveMetricValidationError(
    reason,
    `Objective metric "${context.metricName}" for fixture "${context.fixtureId}" ${detail}`,
    { fixtureId: context.fixtureId, metricName: context.metricName },
  );
}

function isOutsideDirectory(directory: string, candidate: string): boolean {
  const rel = relative(directory, candidate);
  return (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  );
}

function resolveArtifactPath(context: MetricArtifactContext): {
  workingRoot: string;
  artifactPath: string;
} {
  if (
    context.relativePath.length === 0 ||
    context.relativePath.includes("\0") ||
    isAbsolute(context.relativePath)
  ) {
    throw artifactError(
      context,
      "source-failed",
      `refuses non-relative artifact path ${JSON.stringify(context.relativePath)}.`,
    );
  }
  const workingRoot = resolve(context.workingDir);
  const artifactPath = resolve(workingRoot, context.relativePath);
  if (isOutsideDirectory(workingRoot, artifactPath)) {
    throw artifactError(
      context,
      "source-failed",
      `refuses artifact path outside the fixture working directory: ${JSON.stringify(context.relativePath)}.`,
    );
  }
  return { workingRoot, artifactPath };
}

function readEntryStats(
  context: MetricArtifactContext,
  path: string,
): Stats {
  try {
    return lstatSync(path);
  } catch (error) {
    const code = (error as NodeFileSystemError).code;
    if (code === "ENOENT") {
      throw artifactError(
        context,
        "missing-source",
        `is missing artifact ${JSON.stringify(context.relativePath)}.`,
      );
    }
    throw artifactError(
      context,
      "source-failed",
      `could not safely inspect artifact ${JSON.stringify(context.relativePath)}.`,
    );
  }
}

function inspectArtifactPath(
  context: MetricArtifactContext,
  workingRoot: string,
  artifactPath: string,
): Stats {
  const segments = relative(workingRoot, artifactPath).split(sep);
  let current = workingRoot;
  let artifactStats: Stats | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const stats = readEntryStats(context, current);
    if (stats.isSymbolicLink()) {
      throw artifactError(
        context,
        "source-failed",
        `refuses symbolic links in artifact path ${JSON.stringify(context.relativePath)}.`,
      );
    }
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw artifactError(
        context,
        "source-failed",
        `artifact path ${JSON.stringify(context.relativePath)} traverses a non-directory entry.`,
      );
    }
    artifactStats = stats;
  }
  if (artifactStats === null) {
    throw artifactError(
      context,
      "source-failed",
      `refuses artifact path ${JSON.stringify(context.relativePath)}.`,
    );
  }
  if (!artifactStats.isFile()) {
    throw artifactError(
      context,
      "source-failed",
      `artifact ${JSON.stringify(context.relativePath)} is not a regular file.`,
    );
  }
  return artifactStats;
}

function openArtifactDescriptor(
  context: MetricArtifactContext,
  artifactPath: string,
): number {
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw artifactError(
      context,
      "source-failed",
      "requires host support for no-follow file opens.",
    );
  }
  try {
    return openSync(
      artifactPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as NodeFileSystemError).code;
    if (code === "ENOENT") {
      throw artifactError(
        context,
        "missing-source",
        `is missing artifact ${JSON.stringify(context.relativePath)}.`,
      );
    }
    if (code === "ELOOP") {
      throw artifactError(
        context,
        "source-failed",
        `refuses symbolic links in artifact path ${JSON.stringify(context.relativePath)}.`,
      );
    }
    throw artifactError(
      context,
      "source-failed",
      `could not safely open artifact ${JSON.stringify(context.relativePath)}.`,
    );
  }
}

function readBoundedDescriptor(
  context: MetricArtifactContext,
  descriptor: number,
  expectedStats: Stats,
): string {
  const openedStats = fstatSync(descriptor);
  if (
    !openedStats.isFile() ||
    openedStats.dev !== expectedStats.dev ||
    openedStats.ino !== expectedStats.ino
  ) {
    throw artifactError(
      context,
      "source-failed",
      `artifact ${JSON.stringify(context.relativePath)} is not a stable regular file.`,
    );
  }
  if (
    !Number.isSafeInteger(openedStats.size) ||
    openedStats.size < 0 ||
    openedStats.size > MAX_OBJECTIVE_METRIC_ARTIFACT_BYTES
  ) {
    throw artifactError(
      context,
      "source-failed",
      `artifact ${JSON.stringify(context.relativePath)} exceeds the ${MAX_OBJECTIVE_METRIC_ARTIFACT_BYTES}-byte limit.`,
    );
  }

  const buffer = Buffer.alloc(openedStats.size);
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = readSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      null,
    );
    if (bytesRead === 0) {
      throw artifactError(
        context,
        "source-failed",
        `artifact ${JSON.stringify(context.relativePath)} changed while it was being read.`,
      );
    }
    offset += bytesRead;
  }

  const growthProbe = Buffer.allocUnsafe(1);
  if (readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
    throw artifactError(
      context,
      "source-failed",
      `artifact ${JSON.stringify(context.relativePath)} changed while it was being read.`,
    );
  }
  const finalStats = fstatSync(descriptor);
  if (
    finalStats.size !== openedStats.size ||
    finalStats.mtimeMs !== openedStats.mtimeMs ||
    finalStats.ctimeMs !== openedStats.ctimeMs
  ) {
    throw artifactError(
      context,
      "source-failed",
      `artifact ${JSON.stringify(context.relativePath)} changed while it was being read.`,
    );
  }
  return buffer.toString("utf8");
}

export function readObjectiveMetricArtifact(
  context: MetricArtifactContext,
): string {
  const { workingRoot, artifactPath } = resolveArtifactPath(context);
  const expectedStats = inspectArtifactPath(context, workingRoot, artifactPath);
  const descriptor = openArtifactDescriptor(context, artifactPath);
  let result: string | null = null;
  let failure: Error | null = null;
  try {
    result = readBoundedDescriptor(context, descriptor, expectedStats);
  } catch (error) {
    failure =
      error instanceof ObjectiveMetricValidationError
        ? error
        : artifactError(
            context,
            "source-failed",
            `could not safely read artifact ${JSON.stringify(context.relativePath)}.`,
          );
  }
  try {
    closeSync(descriptor);
  } catch {
    if (failure === null) {
      failure = artifactError(
        context,
        "source-failed",
        `could not safely close artifact ${JSON.stringify(context.relativePath)}.`,
      );
    }
  }
  if (failure !== null) throw failure;
  if (result === null) {
    throw artifactError(
      context,
      "source-failed",
      `could not safely read artifact ${JSON.stringify(context.relativePath)}.`,
    );
  }
  return result;
}
