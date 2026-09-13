import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import type { WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { WORKFLOW_RUN_METADATA_VERSION } from "#core/workflow/run-metadata.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { setTerminalTransport, TerminalTransport } from "#modules/rendering/transport.js";
import type { WorkflowClient } from "../client.js";
import workflowOpsModule from "../index.js";
import { buildLocalWorkflowHandler, makeWorkflowOpsScopeRoot } from "../local-client-test-helpers.js";
import { registerRunShowCommand } from "./run-show.js";

const runId = "2026-09-13T00-00-00-000Z-builder-show";
const parentId = "2026-09-12T00-00-00-000Z-dispatcher-parent";
const startedAt = "2026-09-13T00:00:00.000Z";

describe("workflow show command", () => {
  let scopeRoot: string;
  let local: WorkflowClient;
  let output: string;
  let metadata: WorkflowRunMetadata;

  function save(run: WorkflowRunMetadata = metadata): void {
    const dir = join(scopeRoot, ".kota", "runs", run.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(run));
  }

  async function show(client: WorkflowClient, ...args: string[]): Promise<string> {
    output = "";
    const command = new Command("workflow");
    registerRunShowCommand(command, { cwd: scopeRoot, client: { workflow: client } });
    await command.parseAsync(["show", ...args], { from: "user" });
    return output;
  }

  beforeEach(() => {
    scopeRoot = makeWorkflowOpsScopeRoot();
    const state = new RunStateDatabase(join(scopeRoot, ".kota"));
    state.registerScope({ id: deriveDirectoryScopeId(scopeRoot), rootPath: scopeRoot, createdAt: startedAt });
    state.close();
    local = buildLocalWorkflowHandler(scopeRoot);
    setTerminalTransport(new TerminalTransport({
      theme: NO_COLOR_THEME,
      width: 160,
      stream: { write: (text) => { output += text; return true; } },
    }));
    metadata = {
      metadataVersion: WORKFLOW_RUN_METADATA_VERSION,
      id: runId, workflow: "builder", definitionPath: "builder/workflow.ts",
      runDir: join(scopeRoot, ".kota", "runs", runId),
      trigger: { event: "manual", schemaRef: null, payload: { taskId: "task-example", accessToken: "private-token" } },
      startedAt, completedAt: startedAt, durationMs: 0, status: "completed-with-warnings",
      tags: ["operator-tag"], retryOf: "prior-attempt", resumedFromRunId: "retained-attempt",
      causedBy: { runId: parentId, workflow: "dispatcher" }, triggeredByRunId: parentId,
      delivery: { kind: "blocked", taskId: "task-example", taskTitle: "Example", blocker: "needs owner" },
      usage: UNKNOWN_AGENT_USAGE,
      warnings: [{ type: "output-schema-mismatch", message: "contact owner@example.test" }],
      continuations: [{
        stepId: "build", decidedAt: startedAt,
        decision: { decision: "preserve-yield", rationale: "higher priority work", nextAction: "resume validation" },
        packet: {
          version: 2, evidenceFingerprint: "evidence", boundaryKey: "boundary",
          boundaries: ["higher-priority-work"], taskContract: "Example task",
          workspace: { fingerprint: "workspace", changedPaths: [], diffStat: "", diff: "" },
          verificationTrajectory: [], remainingFailures: [],
          queue: { revision: "queue", available: [] },
          current: { id: "task-example", priority: 2, priorityLabel: "p2" }, higherPriorityWork: [],
        },
      }],
      steps: [
        { id: "build", type: "agent", status: "failed", startedAt, completedAt: startedAt, durationMs: 0,
          usage: UNKNOWN_AGENT_USAGE, error: "token=private-error", output: { full: "x".repeat(150) } },
        { id: "zero", type: "agent", status: "success", startedAt, completedAt: startedAt, durationMs: 1,
          usage: { tokens: { state: "unknown" }, cost: { state: "complete", usd: 0 } }, output: null },
        { id: "unpriced", type: "agent", status: "success", startedAt, completedAt: startedAt, durationMs: 2,
          usage: { tokens: { state: "unknown" }, cost: { state: "unavailable", reason: "provider-does-not-report" } } },
        { id: "skip", type: "code", status: "skipped", startedAt, completedAt: startedAt, durationMs: 0,
          skipReason: { kind: "when-predicate" } },
      ],
    };
    save();
  });

  afterEach(() => {
    setTerminalTransport(null);
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("renders local detail with delivery, continuation, redaction and truthful costs", async () => {
    const text = await show(local, "2026-09-13", "--payload");
    for (const expected of ["blocked (task-example: needs owner)", "operator-tag", "preserve-yield",
      "higher priority work", "resume validation", "prior-attempt", "retained-attempt",
      "unknown", "$0.0000", "unavailable", "Skipped: when-predicate", "output-schema-mismatch", "[redacted]"]) {
      expect(text).toContain(expected);
    }
    for (const secret of ["private-token", "private-error", "owner@example.test"]) expect(text).not.toContain(secret);
    expect(text).toMatch(/Duration:\s+0ms/);
    expect(text).not.toContain("Output:");
    expect(await show(local, runId)).not.toContain("Payload:");
  });

  it("derives local delivery from the selected scope's task evidence", async () => {
    delete metadata.delivery;
    metadata.status = "success";
    save();
    const archive = join(scopeRoot, "data", "tasks", "archive");
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "task-example.md"), "---\nstatus: done\n---\n# Example\n");
    expect(await show(local, runId)).toContain("completed (task-example)");
  });

  it("keeps full artifact outputs, nulls and errors on --step", async () => {
    expect(await show(local, runId, "--step", "build")).toBe("token=private-error\n");
    delete metadata.steps[0]!.error;
    save();
    expect(JSON.parse(await show(local, runId, "--step", "build"))).toEqual({ full: "x".repeat(150) });
    expect(await show(local, runId, "--step", "zero")).toBe("null\n");
  });

  it("renders plain-text run errors and the causal ancestor chain", async () => {
    writeFileSync(join(metadata.runDir, "error.txt"), "first error line\nsecond error line");
    expect(await show(local, runId)).toContain("first error line\nsecond error line");
    save({ ...metadata, id: parentId, workflow: "dispatcher", causedBy: undefined, triggeredByRunId: undefined });
    const chain = await show(local, runId, "--chain");
    expect(chain).toContain(`dispatcher/${parentId}`);
    expect(chain).toContain(`builder/${runId}`);
    expect(chain).toContain("← current");
  });

  it("renders daemon detail without requiring storage-only fields or inferring missing delivery", async () => {
    const result = await local.getRun(runId);
    if (!result.found) throw new Error("Missing fixture");
    const detail: WorkflowRunDetail = { ...result.run, status: "queued", delivery: undefined, completedAt: undefined };
    const paths: string[] = [];
    const transport: DaemonTransport = {
      baseUrl: "http://127.0.0.1:0", authHeaders: () => ({}),
      request: async <T>(_method: string, path: string): Promise<T> => {
        paths.push(path);
        return { runs: [] } as T;
      },
      requestStrict: async <T>(_method: string, path: string): Promise<T> => { paths.push(path); return { runs: [] } as T; },
      fetchRaw: async (path) => {
        paths.push(path);
        return Response.json(path === "/workflow/status" ? await local.status() : detail);
      },
      events: async function* () {},
    };
    const daemon = workflowOpsModule.daemonClient!(transport).workflow!;
    const text = await show(daemon, runId, "--payload");
    expect(text).toContain("queued");
    expect(text).toMatch(/Delivery:\s+— unavailable/);
    expect(text).not.toContain("Finished:");
    expect(text).toContain("operator-tag");
    expect(text).toContain("preserve-yield");
    expect(text).toContain("unknown");
    expect(text).not.toContain("private-token");
    expect(paths).toContain(`/workflow/runs/${runId}`);
    detail.delivery = { kind: "needs_attention", reason: "publication retained" };
    expect(await show(daemon, runId)).toContain("needs_attention: publication retained");
  });
});
