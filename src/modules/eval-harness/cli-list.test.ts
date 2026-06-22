import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvalCommand } from "./cli.js";
import { makeListCtx } from "./cli-test-support.js";
import type { EvalListResult } from "./client.js";

async function captureStdout(fn: () => Promise<object | void>): Promise<string> {
  const chunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    chunks.push(String(data));
    return true;
  });
  try {
    await fn();
  } finally {
    stdoutSpy.mockRestore();
  }
  return chunks.join("");
}

describe("kota eval list CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits fixture control decisions and aggregate coverage as JSON", async () => {
    const result: EvalListResult = {
      fixtures: [
        {
          id: "builder-smoke",
          description: "builder smoke",
          role: "builder",
          workflowName: "builder",
          controlDecisions: ["act"],
          tags: ["smoke"],
        },
      ],
      controlDecisionCoverage: {
        counts: {
          act: 1,
          ask: 0,
          refuse: 0,
          stop: 0,
          confirm: 0,
          recover: 0,
        },
        missingDecisions: ["ask", "refuse", "stop", "confirm", "recover"],
        missingDecisionWarnings: [
          {
            decision: "ask",
            message: 'No eval fixture declares control decision "ask".',
          },
        ],
      },
    };
    const cmd = buildEvalCommand(makeListCtx(result));

    const output = await captureStdout(() => cmd.parseAsync(["list", "--json"], { from: "user" }));

    const parsed = JSON.parse(output) as EvalListResult;
    expect(parsed.fixtures[0]).toMatchObject({
      id: "builder-smoke",
      controlDecisions: ["act"],
    });
    expect(parsed.controlDecisionCoverage.counts.act).toBe(1);
    expect(parsed.controlDecisionCoverage.missingDecisionWarnings[0]).toEqual({
      decision: "ask",
      message: 'No eval fixture declares control decision "ask".',
    });
  });

  it("prints compact coverage counts and missing-decision warnings", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      writes.push(String(data));
      return true;
    });
    const cmd = buildEvalCommand(
      makeListCtx({
        fixtures: [
          {
            id: "stop-fixture",
            description: "stop coverage",
            role: "builder",
            workflowName: "builder",
            controlDecisions: ["stop"],
            tags: [],
          },
        ],
        controlDecisionCoverage: {
          counts: {
            act: 0,
            ask: 0,
            refuse: 0,
            stop: 1,
            confirm: 0,
            recover: 0,
          },
          missingDecisions: ["act"],
          missingDecisionWarnings: [
            {
              decision: "act",
              message: 'No eval fixture declares control decision "act".',
            },
          ],
        },
      }),
    );

    await cmd.parseAsync(["list"], { from: "user" });

    const text = writes.join("\n");
    expect(text).toContain("control decisions:");
    expect(text).toContain("stop=1");
    expect(text).toContain("missing control-decision coverage: act");
    expect(text).toContain("decisions=stop");
  });
});
