import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkRunCommitMessage,
  RUN_COMMIT_MESSAGE_FILENAME,
  readRunCommitMessage,
} from "./run-commit-message.js";

const roots: string[] = [];

function makeArtifactDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-run-commit-message-"));
  roots.push(root);
  const directory = join(root, "artifacts");
  mkdirSync(directory);
  return directory;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("readRunCommitMessage", () => {
  it("returns one trimmed meaningful message from runtime-owned artifacts", () => {
    const agentDirectory = makeArtifactDirectory();
    const workflowDirectory = makeArtifactDirectory();
    writeFileSync(
      join(agentDirectory, RUN_COMMIT_MESSAGE_FILENAME),
      "  deliver isolated writer change\n\nDetails\n",
    );

    expect(
      readRunCommitMessage([agentDirectory, workflowDirectory]),
    ).toBe("deliver isolated writer change\n\nDetails");
  });

  it("returns undefined when messages are absent or blank", () => {
    const absentDirectory = makeArtifactDirectory();
    const blankDirectory = makeArtifactDirectory();
    writeFileSync(join(blankDirectory, RUN_COMMIT_MESSAGE_FILENAME), " \n\t");

    expect(
      readRunCommitMessage([absentDirectory, blankDirectory]),
    ).toBeUndefined();
  });

  it("provides a repair-check failure for a missing meaningful message", () => {
    const directory = makeArtifactDirectory();

    expect(() => checkRunCommitMessage(directory)).toThrow(
      "Missing meaningful run commit message",
    );
  });

  it("rejects conflicting messages from distinct artifact directories", () => {
    const first = makeArtifactDirectory();
    const second = makeArtifactDirectory();
    writeFileSync(join(first, RUN_COMMIT_MESSAGE_FILENAME), "first\n");
    writeFileSync(join(second, RUN_COMMIT_MESSAGE_FILENAME), "second\n");

    expect(() => readRunCommitMessage([first, second])).toThrow(
      "conflicting commit messages",
    );
  });

  it("rejects a symlinked commit-message artifact", () => {
    const directory = makeArtifactDirectory();
    const outside = join(directory, "outside.txt");
    writeFileSync(outside, "redirected\n");
    symlinkSync(outside, join(directory, RUN_COMMIT_MESSAGE_FILENAME));

    expect(() => readRunCommitMessage([directory])).toThrow(
      "not a regular file",
    );
  });
});
