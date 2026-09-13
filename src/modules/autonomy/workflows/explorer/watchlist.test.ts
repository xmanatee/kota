import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { createStepContext } from "#core/workflow/steps/step-context.js";
import { unexpectedWorkflowAgentHarnessRun } from "#core/workflow/testing/agent-harness-runner.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  parseWatchlist,
  readWatchlist,
} from "./watchlist.js";
import {
  normalizeWatchlistContent,
} from "./watchlist-classifier.js";
import explorerWorkflow from "./workflow.js";

describe("parseWatchlist", () => {
  it("parses the seed format with only url + added fields", () => {
    const raw = [
      "# header comment",
      "resources:",
      "  - url: https://example.com/a",
      '    added: "2026-04-14"',
      "  - url: https://example.com/b",
      '    added: "2026-04-15"',
      "",
    ].join("\n");

    const file = parseWatchlist(raw);

    expect(file.entries).toEqual([
      { url: "https://example.com/a", added: "2026-04-14" },
      { url: "https://example.com/b", added: "2026-04-15" },
    ]);
  });

  it("rejects a snapshot block missing required fields", () => {
    const raw = [
      "resources:",
      "  - url: https://example.com/a",
      '    added: "2026-04-14"',
      "    snapshot:",
      "      fingerprint: abc",
      "",
    ].join("\n");

    expect(() => parseWatchlist(raw)).toThrow(/resources\.0\.snapshot\.summary/);
  });

  it("rejects unknown top-level fields", () => {
    const raw = [
      "resources:",
      "  - url: https://example.com/a",
      '    added: "2026-04-14"',
      "    mystery: value",
      "",
    ].join("\n");

    expect(() => parseWatchlist(raw)).toThrow(/Unrecognized key.*mystery/);
  });

  it.each([
    ["# no resources", /expected object/],
    ["resources: []\nother: true", /Unrecognized key.*other/],
    ["resources: null", /resources/],
    ["resources: [", /YAML/],
    ["resources: []\nresources: []", /unique/],
    ["resources: []\n---\nresources: []", /multiple documents/],
    ["resources: !unknown []", /Unresolved tag/],
    ["resources: [{url: true, added: 2026-04-14}]", /resources\.0\.url/],
    ["resources: [{url: https://example.com, added: 123}]", /resources\.0\.added/],
    ["resources: [{url: https://example.com, added: 2026-04-14, status: active}]", /resources\.0\.status/],
    ["resources: [&source {url: https://example.com, added: 2026-04-14}, *source]", /duplicate watchlist entry url/],
  ])("diagnoses malformed input without dropping it: %s", (raw, diagnostic) => {
    expect(() => parseWatchlist(raw)).toThrow(diagnostic);
  });

  it("rejects canonicalized aliases that remain listed as refresh resources", () => {
    const raw = [
      "resources:",
      "  - url: https://example.com/current",
      '    added: "2026-04-14"',
      "    canonicalized_from:",
      "      - https://example.com/old",
      "  - url: https://example.com/old",
      '    added: "2026-04-14"',
      "",
    ].join("\n");

    expect(() => parseWatchlist(raw)).toThrow(/still listed as a resource/);
  });
});

describe("normalizeWatchlistContent", () => {
  it("is stable across trivial whitespace churn", () => {
    const a = normalizeWatchlistContent("Hello   World\nFoo\tBar");
    const b = normalizeWatchlistContent("hello world foo bar");
    expect(a).toBe(b);
  });

  it("strips ISO date timestamps", () => {
    const a = normalizeWatchlistContent(
      "Updated 2026-04-17T10:15:32.123Z and ready to ship.",
    );
    const b = normalizeWatchlistContent(
      "Updated 2026-04-18T11:22:33Z and ready to ship.",
    );
    expect(a).toBe(b);
  });

  it("strips relative time churn", () => {
    const a = normalizeWatchlistContent("pushed 2 hours ago by user");
    const b = normalizeWatchlistContent("pushed 5 hours ago by user");
    expect(a).toBe(b);
  });

  it("produces different output for genuinely different content", () => {
    const a = normalizeWatchlistContent("An autonomous agent for dev");
    const b = normalizeWatchlistContent("A CLI tool for git operations");
    expect(a).not.toBe(b);
  });
});

describe("direct watchlist editing", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "watchlist-test-"));
    mkdirSync(join(root, "data"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function validate(boundary: "repair" | "publication") {
    const runCommand = createWorkflowCommandRunner({ cwd: root });
    if (boundary === "publication") {
      const policy = explorerWorkflow.integration!;
      for (const [command, ...args] of [policy.validationCommand, ...policy.additionalValidationCommands ?? []]) {
        await runCommand({ command, args });
      }
      return;
    }
    const bus = new EventBus();
    const trigger = { event: "autonomy.queue.empty", schemaRef: null, payload: {} };
    const ctx = createStepContext({
      id: "watchlist-test", workflow: "explorer", definitionPath: "workflow.ts", trigger,
      startedAt: new Date().toISOString(), status: "running", runDir: ".kota/runs/watchlist-test", steps: [],
    }, trigger, undefined, {}, {}, [], {
      workspaceRoot: root, scopeRoot: root, bus, pbus: new ScopedEventBus(bus, "test"),
      store: new WorkflowRunStore(root), readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runAgentHarness: unexpectedWorkflowAgentHarnessRun, runCommand,
    });
    const explore = explorerWorkflow.steps.find((step) => step.id === "explore");
    if (explore?.type !== "agent" || !explore.repairLoop) throw new Error("Explorer repair checks missing");
    for (const check of explore.repairLoop.checks) {
      if (check.type !== "code") throw new Error("Expected objective validation");
      await check.run(ctx, {
        id: explore.id, type: "agent", harness: "test", moduleRoot: root,
        promptPath: "prompt.md", model: "test", effort: "high", autonomyMode: "autonomous",
      });
    }
  }

  it.each(["repair", "publication"] as const)("validates completed files without rewriting them at %s", async (boundary) => {
    await validate(boundary);
    const path = join(root, "data/watchlist.yaml");
    const invalid = "resources: [{url: https://example.com, added: 123}]\n";
    writeFileSync(path, invalid);
    await expect(validate(boundary)).rejects.toThrow(/resources\.0\.added/);
    expect(readFileSync(path, "utf8")).toBe(invalid);
    const edited = [
      "# Operator header",
      "resources:",
      "  - url: https://example.com/current # source identity",
      "    added: &added 2026-04-14",
      "    canonicalized_from: ['https://example.com/old']",
      "    notes: 'Owner''s C:\\work\\n is literal' # operator note",
      "    status: inaccessible",
      "    snapshot:",
      '      fingerprint: "123"',
      "      summary: |",
      '        A "quoted" observation with literal \\n and C:\\work.',
      "        Second line.",
      "      last_seen_at: 2026-04-17T10:00:00.000Z",
      "  - url: https://example.com/another",
      "    added: *added",
      "# Footer",
      "",
    ].join("\n");
    writeFileSync(path, edited);
    await validate(boundary);
    expect(readFileSync(path, "utf8")).toBe(edited);
    expect(readWatchlist(root).entries[0]).toMatchObject({
      canonicalizedFrom: ["https://example.com/old"],
      status: "inaccessible",
      notes: "Owner's C:\\work\\n is literal",
      snapshot: { fingerprint: "123", summary: 'A "quoted" observation with literal \\n and C:\\work.\nSecond line.\n' },
    });
    expect(readWatchlist(root).entries[1]).toEqual({
      url: "https://example.com/another", added: "2026-04-14",
    });
    writeFileSync(path, "resources: []\n");
    await validate(boundary);
    expect(readWatchlist(root).entries).toEqual([]);
    mkdirSync(join(root, "data/tasks"));
    writeFileSync(join(root, "data/tasks/task-invalid.md"), "---\nstatus: invalid\n---\n# Invalid task\n");
    await expect(validate(boundary)).rejects.toThrow(/task-status-invalid/);
    expect(readFileSync(path, "utf8")).toBe("resources: []\n");
  });
});
