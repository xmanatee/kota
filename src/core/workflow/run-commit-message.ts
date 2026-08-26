import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const RUN_COMMIT_MESSAGE_FILENAME = "commit-message.txt";

function assertRuntimeOwnedDirectory(directory: string): string {
  if (!isAbsolute(directory)) {
    throw new Error(`Run artifact directory must be absolute: ${directory}`);
  }
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Run artifact directory is not a regular directory: ${directory}`);
  }
  return realpathSync(directory);
}

function assertContainedFile(directory: string, path: string): void {
  const child = relative(directory, realpathSync(path));
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error(`Run commit message is outside its artifact directory: ${path}`);
  }
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Run commit message is not a regular file: ${path}`);
  }
}

/** Reads one unambiguous, non-empty commit message from runtime-owned artifacts. */
export function readRunCommitMessage(
  artifactDirectories: readonly string[],
): string | undefined {
  const messages = new Set<string>();
  const visited = new Set<string>();
  for (const candidate of artifactDirectories) {
    const directory = resolve(candidate);
    if (visited.has(directory) || !existsSync(directory)) continue;
    visited.add(directory);
    const ownedDirectory = assertRuntimeOwnedDirectory(directory);
    const path = resolve(ownedDirectory, RUN_COMMIT_MESSAGE_FILENAME);
    if (!existsSync(path)) continue;
    assertContainedFile(ownedDirectory, path);
    const message = readFileSync(path, "utf8").trim();
    if (!message) continue;
    if (message.includes("\0")) {
      throw new Error(`Run commit message contains a null byte: ${path}`);
    }
    messages.add(message);
  }
  if (messages.size > 1) {
    throw new Error("Run artifacts contain conflicting commit messages");
  }
  return messages.values().next().value;
}

export function checkRunCommitMessage(artifactDirectory: string): string {
  const message = readRunCommitMessage([artifactDirectory]);
  if (message === undefined) {
    throw new Error(
      `Missing meaningful run commit message: ${resolve(
        artifactDirectory,
        RUN_COMMIT_MESSAGE_FILENAME,
      )}`,
    );
  }
  return `OK: ${RUN_COMMIT_MESSAGE_FILENAME} present (${message.split("\n").length} line(s))`;
}
