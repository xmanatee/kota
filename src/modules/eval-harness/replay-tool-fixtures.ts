import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDef } from "#core/modules/module-types.js";
import {
  localWriteEffect,
  readOnlyLocalEffect,
} from "#core/tools/effect.js";
import type { ToolRunnerContext } from "#core/tools/index.js";

const PR_REVIEWER_FIXTURE_ID = "pr-reviewer-agent-call-replay";

type ReplayFixtureIdentity = {
  id?: string;
  workflowName?: string;
};

function isPrReviewerReplayFixture(replayRoot: string): boolean {
  try {
    const fixture = JSON.parse(
      readFileSync(join(replayRoot, "fixture.json"), "utf8"),
    ) as ReplayFixtureIdentity;
    return (
      fixture.id === PR_REVIEWER_FIXTURE_ID &&
      fixture.workflowName === "pr-reviewer"
    );
  } catch {
    return false;
  }
}

function appendReplayToolCall(
  tool: string,
  input: Parameters<ToolDef["runner"]>[0],
  context?: ToolRunnerContext,
): string | null {
  if (context?.cwd === undefined) return null;
  const dir = join(context.cwd, ".kota", "external-calls");
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, `${tool}.jsonl`),
    `${JSON.stringify({
      tool,
      input,
      exitCode: 0,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  return dir;
}

function prReviewerReplayTools(): ToolDef[] {
  return [
    {
      effect: readOnlyLocalEffect(),
      tool: {
        name: "github_get_pr",
        description: "Read recorded GitHub PR details for an eval replay.",
        input_schema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            number: { type: "number" },
          },
          required: ["number"],
        },
      },
      async runner() {
        return { content: "Recorded PR details for eval replay." };
      },
    },
    {
      effect: readOnlyLocalEffect(),
      tool: {
        name: "github_list_prs",
        description: "Read a recorded GitHub PR list for an eval replay.",
        input_schema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            state: { type: "string" },
            head: { type: "string" },
          },
          required: [],
        },
      },
      async runner() {
        return { content: "Recorded PR list for eval replay." };
      },
    },
    {
      effect: localWriteEffect(),
      tool: {
        name: "github_comment",
        description:
          "Record a simulated GitHub comment inside an isolated eval workspace.",
        input_schema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            number: { type: "number" },
            body: { type: "string" },
          },
          required: ["number", "body"],
        },
      },
      async runner(input, context) {
        if (appendReplayToolCall("github_comment", input, context) === null) {
          return {
            content: "Eval replay tool requires an explicit workflow cwd.",
            is_error: true,
          };
        }
        return {
          content:
            "Comment simulated locally (ID: 4242)\nhttps://github.invalid/kota-test/example/issues/42#issuecomment-4242",
        };
      },
    },
  ];
}

/**
 * Replay-only tool simulations are compiled into the trusted eval module.
 * They never load executable code from the copied fixture project and their
 * declared effects describe the local recording they actually perform.
 */
export function createReplayToolFixtureDefs(
  replayRoot: string | null,
): ToolDef[] {
  if (replayRoot === null || !isPrReviewerReplayFixture(replayRoot)) return [];
  return prReviewerReplayTools();
}
