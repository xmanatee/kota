import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReplayToolFixtureDefs } from "./replay-tool-fixtures.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function makeReplayRoot(id = "pr-reviewer-agent-call-replay"): string {
  const root = mkdtempSync(join(tmpdir(), "kota-replay-tools-"));
  cleanup.push(root);
  writeFileSync(
    join(root, "fixture.json"),
    JSON.stringify({ id, workflowName: "pr-reviewer" }),
  );
  return root;
}

describe("createReplayToolFixtureDefs", () => {
  it("does not contribute tools for unrelated replay fixtures", () => {
    expect(createReplayToolFixtureDefs(makeReplayRoot("other-fixture"))).toEqual(
      [],
    );
  });

  it("records the PR-review comment as a local fixture effect", async () => {
    const replayRoot = makeReplayRoot();
    const cwd = join(replayRoot, "work");
    mkdirSync(cwd);
    const tools = createReplayToolFixtureDefs(replayRoot);

    expect(tools.map((definition) => definition.tool.name)).toEqual([
      "github_get_pr",
      "github_list_prs",
      "github_comment",
    ]);
    expect(tools.map((definition) => definition.effect.scope)).toEqual([
      "local-fs",
      "local-fs",
      "local-fs",
    ]);

    const comment = tools[2];
    if (comment === undefined) throw new Error("missing replay comment tool");
    const result = await comment.runner(
      { repo: "kota-test/example", number: 42, body: "Looks good." },
      { cwd },
    );

    expect(result.is_error).not.toBe(true);
    expect(
      readFileSync(
        join(cwd, ".kota", "external-calls", "github_comment.jsonl"),
        "utf8",
      ),
    ).toContain('"repo":"kota-test/example","number":42');
  });
});
