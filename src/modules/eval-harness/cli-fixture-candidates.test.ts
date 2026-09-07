import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvalCommand } from "./cli.js";
import { makeFakeCtx } from "./cli-test-support.js";
import { mineFixtureCandidates } from "./fixture-candidates.js";

vi.mock("./fixture-candidates.js", () => ({ mineFixtureCandidates: vi.fn() }));

describe("kota eval fixture-candidates CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("forwards scan options and renders the returned summary and artifact paths", async () => {
    // Authored boundary response; classification, persistence and task creation
    // are exercised by the fixture-candidates domain suites.
    vi.mocked(mineFixtureCandidates).mockReturnValue({
      report: {
        version: 1,
        input: {
          runsDir: "/scope/runs",
          runIds: [],
          workflow: null,
          limit: 3,
          since: null,
          createTask: true,
        },
        totals: { scannedRuns: 9, viable: 4, needsReview: 3, rejected: 2 },
        dispositionTotals: {
          proposed: 3,
          accepted: 1,
          rejected: 2,
          duplicate: 0,
          "needs-owner-evidence": 3,
        },
        candidates: [],
      },
      jsonPath: "/scope/reports/candidates.json",
      summaryPath: "/scope/reports/candidates.md",
    });
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      writes.push(String(data));
      return true;
    });

    await buildEvalCommand(makeFakeCtx("/scope")).parseAsync(
      [
        "fixture-candidates",
        "--run-id", "run-a",
        "--run-id", "run-b",
        "--output-dir", "reports",
        "--runs-dir", "runs",
        "--workflow", "builder",
        "--limit", "3",
        "--since", "2026-06-01T00:00:00.000Z",
        "--create-task",
      ],
      { from: "user" },
    );

    expect(mineFixtureCandidates).toHaveBeenCalledWith("/scope", {
      outputDir: "reports",
      runIds: ["run-a", "run-b"],
      runsDir: "runs",
      workflow: "builder",
      limit: 3,
      since: "2026-06-01T00:00:00.000Z",
      createTask: true,
    });
    const output = writes.join("");
    for (const text of [
      "fixture candidates:", "9 scanned", "4 viable", "3 needs-review",
      "2 rejected", "1 accepted", "json: /scope/reports/candidates.json",
      "summary: /scope/reports/candidates.md",
    ]) {
      expect(output).toContain(text);
    }
  });
});
