import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";

const SAFE_RECORDER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function requireRecorderIdentifier(value: string, label: string): string {
  if (
    !SAFE_RECORDER_IDENTIFIER.test(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new Error(
      `${label} must be a safe single path component matching ${SAFE_RECORDER_IDENTIFIER}: ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function isInsideOrSameDirectory(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function resolveRecordingFixtureDir(
  fixturesRoot: string,
  fixtureId: string,
): string {
  const safeFixtureId = requireRecorderIdentifier(fixtureId, "--fixture");
  const root = resolve(fixturesRoot);
  const fixtureDir = resolve(root, safeFixtureId);
  if (!isInsideOrSameDirectory(root, fixtureDir) || fixtureDir === root) {
    throw new Error(
      `--fixture must resolve inside the eval-harness fixtures directory: ${JSON.stringify(fixtureId)}.`,
    );
  }
  return join(root, safeFixtureId);
}
