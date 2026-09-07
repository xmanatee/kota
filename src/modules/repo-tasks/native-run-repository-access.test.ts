import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireRunWriterWorkspace } from "#core/workflow/run-context.js";
import { nativeRunRepositoryAccess } from "./native-run-repository-access.js";
import {
  createRepoTaskRuntimeSandbox,
  disposeRepoTaskRuntimeSandboxes,
} from "./repo-task-mutation-test-support.js";

const roots: string[] = [];

afterEach(() => {
  disposeRepoTaskRuntimeSandboxes();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("native run repository access", () => {
  it("reconstructs writer authority from canonical Git and read-only run state", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-run-access-"));
    roots.push(root);
    const runId = "run-native-writer";
    const target = createRepoTaskRuntimeSandbox(root, runId);
    const access = nativeRunRepositoryAccess(target.workspaceRoot, {
      KOTA_RUN_ID: runId,
      KOTA_RUN_ATTEMPT: "1",
      KOTA_DAEMON_EPOCH: "1",
      KOTA_RUN_STATE_DIR: join(root, ".kota"),
    });

    expect(requireRunWriterWorkspace(access ?? undefined)).toBe(target.workspaceRoot);
  });

  it("rejects a writer identity from a different workspace", () => {
    const first = mkdtempSync(join(tmpdir(), "kota-native-run-access-a-"));
    const second = mkdtempSync(join(tmpdir(), "kota-native-run-access-b-"));
    roots.push(first, second);
    createRepoTaskRuntimeSandbox(first, "run-native-writer");

    expect(() => nativeRunRepositoryAccess(second, {
      KOTA_RUN_ID: "run-native-writer",
      KOTA_RUN_ATTEMPT: "1",
      KOTA_DAEMON_EPOCH: "1",
      KOTA_RUN_STATE_DIR: join(first, ".kota"),
    })).toThrow();
  });
});
