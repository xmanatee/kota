import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { InteractiveSession, WorkflowDefinitionSummary } from "#core/daemon/daemon-control.js";
import type { KotaClient } from "#core/server/kota-client.js";
import type { ModuleListEntry } from "#modules/module-manager/client.js";
import type { RenderNode } from "#modules/rendering/primitives.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import type { WorkflowEnableResult } from "#modules/workflow-ops/client.js";
import {
  type NavigatorOutput,
  type NavigatorPrompt,
  NON_TTY_HINT,
  refuseNonTtyLaunch,
  runNavigator,
} from "./navigator.js";

function makePrompt(answers: string[]): NavigatorPrompt {
  let i = 0;
  return {
    ask: async () => (i < answers.length ? answers[i++] : null),
    close: () => {},
  };
}

function makeOutput(): { capture: NavigatorOutput; frames: string[]; nodes: RenderNode[] } {
  const nodes: RenderNode[] = [];
  const frames: string[] = [];
  return {
    capture: {
      write: (node) => {
        nodes.push(node);
        frames.push(renderToString(node, { theme: NO_COLOR_THEME, width: 100 }).trim());
      },
    },
    frames,
    nodes,
  };
}

function emptyClient(overrides: Partial<KotaClient> = {}): KotaClient {
  const stub = <T>(value: T) => vi.fn(async () => value);
  const base: KotaClient = {
    forProject: vi.fn(() => {
      throw new Error("not implemented in test");
    }),
    workflow: {
      listRuns: stub({ runs: [] }),
      status: vi.fn(async () => {
        throw new Error("not implemented in test");
      }),
      getRun: stub({ found: false }),
      listDefinitions: stub({ source: "static", definitions: [] as WorkflowDefinitionSummary[] }),
      pause: stub({ paused: true, already: false }),
      resume: stub({ paused: false, already: false }),
      abort: stub({ status: "applied", count: 0 }),
      reload: stub({ status: "applied", count: 0 }),
      triggerByName: stub({ ok: true, path: "queue", queued: "x" }),
      trial: stub({ ok: false, reason: "daemon_required", message: "stub" }),
      enable: stub({ ok: true } as WorkflowEnableResult),
      disable: stub({ ok: true } as WorkflowEnableResult),
      cancelRun: stub({ ok: true }),
      abortRun: stub({ ok: true }),
      listDeadLetters: stub({
        items: [],
        counts: { open: 0, dismissed: 0, redriven: 0 },
      }),
      getDeadLetter: stub({ found: false }),
      dismissDeadLetter: stub({ ok: false, reason: "not_found" }),
      redriveDeadLetter: stub({ ok: false, reason: "not_found" }),
      exportDeadLetterDiagnostics: stub(null),
    },
    approvals: {
      list: stub({ approvals: [] as PendingApproval[] }),
      approve: stub({ ok: false, reason: "not_found" }),
      reject: stub({ ok: false, reason: "not_found" }),
    },
    secrets: {
      list: stub({ secrets: [] }),
      get: stub({ found: false }),
      set: stub({ ok: true }),
      remove: stub({ ok: true }),
    },
    tasks: {
      list: stub({ tasks: [] }),
      show: stub({ found: false }),
      move: stub({ ok: false, reason: "not_found" }),
      create: stub({ ok: false, reason: "invalid_slug" }),
      capture: stub({ ok: false, reason: "invalid_slug" }),
      gc: stub({ archived: [], deleted: [] }),
      search: stub({ ok: true, tasks: [] }),
      reindex: stub({ indexed: 0, failed: 0 }),
    },
    memory: {
      list: stub({ entries: [] }),
      add: stub({ id: "m1" }),
      delete: stub({ ok: true }),
      search: stub({ ok: true, entries: [] }),
      reindex: stub({ indexed: 0, failed: 0 }),
    },
    ownerDecisions: {
      list: stub({ decisions: [] }),
      show: stub({ found: false }),
      answer: stub({ ok: false, reason: "not_found" }),
      cancel: stub({ ok: false, reason: "not_found" }),
    },
    ownerQuestions: {
      list: stub({ questions: [] }),
      answer: stub({ ok: false, reason: "not_found" }),
      dismiss: stub({ ok: false, reason: "not_found" }),
    },
    history: {
      list: stub({ conversations: [] }),
      listDiscoveredProjectRecords: stub({ conversations: [] }),
      show: stub({ found: false }),
      delete: stub({ ok: true }),
      search: stub({ ok: true, conversations: [] }),
      reindex: stub({ indexed: 0, failed: 0 }),
    },
    knowledge: {
      list: stub({ entries: [] }),
      show: stub({ found: false }),
      search: stub({ ok: true, entries: [] }),
      add: stub({ id: "k1" }),
      delete: stub({ ok: true }),
      reindex: stub({ indexed: 0, failed: 0 }),
    },
    sessions: {
      list: stub({ sessions: [] as InteractiveSession[] }),
      setAutonomyMode: stub({ ok: false, reason: "not_found" }),
    },
    modules: {
      list: stub({ modules: [] as ModuleListEntry[] }),
    },
    agents: {
      list: stub({ agents: [] }),
      inspect: stub({ found: false }),
    },
    skills: {
      list: stub({ skills: [] }),
      import: stub({ ok: false, reason: "missing_name", message: "stub" }),
    },
    harnessParity: {
      list: stub({ scenarios: [] }),
      run: stub({ ok: false, reason: "no_scenarios", message: "stub" }),
    },
    webhook: {
      list: stub({ entries: [] }),
      secretGenerate: stub({ workflow: "stub", secret: "stub", overwrote: false }),
      secretRemove: stub({ ok: true, workflow: "stub", removed: false }),
    },
    voice: {
      transcribe: stub({ ok: false, reason: "daemon_required" }),
      synthesize: stub({ ok: false, reason: "daemon_required" }),
    },
    web: {
      start: stub({ ok: false, reason: "daemon_required" }),
    },
    mcpServer: {
      start: stub({ ok: false, reason: "daemon_required" }),
    },
    audit: {
      list: stub({ entries: [] }),
    },
    config: {
      validate: stub({ sources: [], warnings: [], resolved: {} }),
      get: stub({ found: false, reason: "not_found" }),
      set: stub({ ok: true, unknownKey: false, topKey: "stub", value: null }),
      schemaPath: stub({ path: "/stub" }),
      schemaContent: stub({ content: "{}" }),
    },
    modulesAdmin: {
      inspect: stub({ found: false }),
      reload: stub({ ok: false, reason: "daemon_required" }),
    },
    daemonOps: {
      status: stub({ state: "not_running", managed: false }),
      pid: stub({ state: "not_running" }),
      stop: stub({ ok: false, reason: "not_running" }),
      reload: stub({ ok: false, reason: "not_running" }),
    },
    projects: {
      list: stub({ ok: false, reason: "daemon_required" }),
      use: stub({ ok: false, reason: "daemon_required" }),
    },
    doctor: {
      run: stub({ checks: [] }),
      fix: stub({ repairs: [] }),
    },
    evalHarness: {
      list: stub({
        fixtures: [],
        controlDecisionCoverage: {
          counts: { act: 0, ask: 0, refuse: 0, stop: 0, confirm: 0, recover: 0 },
          missingDecisions: ["act", "ask", "refuse", "stop", "confirm", "recover"],
          missingDecisionWarnings: [],
        },
      }),
      run: stub({ ok: false, reason: "no_fixtures", message: "stub" }),
      calibration: stub({ aggregate: {}, decision: {} }),
    },
    recall: {
      recall: stub({ ok: true, hits: [] }),
    },
    answer: {
      answer: stub({ ok: false, reason: "no_hits" }),
      log: stub({ entries: [] }),
      show: stub({ ok: false, reason: "not_found" }),
    },
    capture: {
      capture: stub({ ok: false, reason: "no_contributors" }),
    },
    retract: {
      retract: stub({ ok: false, reason: "no_contributors" }),
    },
    setup: {
      list: stub({
        requirements: [],
        summary: {
          ready: 0,
          missing: 0,
          pending: 0,
          expired: 0,
          revoked: 0,
          unknown: 0,
          unavailable: 0,
        },
      }),
      submitForm: stub({ ok: false, reason: "not_found", message: "stub" }),
      storeSecret: stub({ ok: false, reason: "not_found", message: "stub" }),
      start: stub({ ok: false, reason: "not_found", message: "stub" }),
      complete: stub({ ok: false, reason: "not_found", message: "stub" }),
      refresh: stub({ ok: false, reason: "not_found", message: "stub" }),
      revoke: stub({ ok: false, reason: "not_found", message: "stub" }),
    },
  };
  return { ...base, ...overrides };
}

describe("runtime navigator", () => {
  it("refuses non-TTY launch and prints the equivalent one-shot hint", () => {
    let captured = "";
    const stderr = { write: (s: string) => { captured += s; return true; } } as unknown as NodeJS.WritableStream;
    refuseNonTtyLaunch(stderr);
    expect(captured.trim()).toBe(NON_TTY_HINT);
  });

  it("renders the main menu, opens modules, and quits cleanly", async () => {
    const modulesEntry: ModuleListEntry = {
      name: "approval-queue",
      source: "project",
      status: "loaded",
      toolCount: 0,
      workflowCount: 0,
      commandCount: 1,
      channelCount: 0,
      skillCount: 0,
      agentCount: 0,
      version: "1.0.0",
      description: "Approval queue state",
    };
    const client = emptyClient({
      modules: { list: vi.fn(async () => ({ modules: [modulesEntry] })) },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["2", "q"]),
      output: output.capture,
    });
    const joined = output.frames.join("\n");
    expect(joined).toMatch(/KOTA navigator/);
    expect(joined).toMatch(/Automations/);
    expect(joined).toMatch(/Modules/);
    expect(joined).toMatch(/approval-queue/);
    expect(client.modules.list).toHaveBeenCalledTimes(1);
  });

  it("approves a pending item via the approvals screen", async () => {
    const pending: PendingApproval = {
      id: "ap_1",
      tool: "shell",
      input: { command: "ls" },
      risk: "moderate",
      reason: "moderate-risk command",
      status: "pending",
      createdAt: new Date().toISOString(),
    } as PendingApproval;
    const approve = vi.fn(async () => ({
      ok: true as const,
      approval: { ...pending, status: "approved" } as PendingApproval,
    }));
    const client = emptyClient({
      approvals: {
        list: vi.fn(async () => ({ approvals: [pending] })),
        approve,
        reject: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["4", "ap_1 approve looks ok", "q"]),
      output: output.capture,
    });
    expect(approve).toHaveBeenCalledWith("ap_1", "looks ok");
    expect(output.frames.join("\n")).toMatch(/Approved ap_1/);
  });

  it("renders invalid approval id responses in the approvals screen", async () => {
    const pending: PendingApproval = {
      id: "abcd1234",
      tool: "shell",
      input: { command: "ls" },
      risk: "moderate",
      reason: "moderate-risk command",
      status: "pending",
      createdAt: new Date().toISOString(),
    } as PendingApproval;
    const approve = vi.fn(async () => ({ ok: false as const, reason: "invalid_id" as const }));
    const client = emptyClient({
      approvals: {
        list: vi.fn(async () => ({ approvals: [pending] })),
        approve,
        reject: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["4", "../abcd1234 approve", "q"]),
      output: output.capture,
    });
    expect(approve).toHaveBeenCalledWith("../abcd1234", undefined);
    expect(output.frames.join("\n")).toMatch(/Invalid approval id/);
  });

  it("toggles a workflow's autonomy registration via the sessions screen", async () => {
    const session: InteractiveSession = {
      id: "sess-1",
      scopeId: "test-project",
      projectId: "test-project",
      createdAt: new Date().toISOString(),
      lastActive: Date.now(),
      autonomyMode: "supervised",
      source: "daemon",
    };
    const setAutonomy = vi.fn(async () => ({
      ok: true as const,
      autonomyMode: "autonomous" as const,
      source: "daemon" as const,
      serveOwned: false,
    }));
    const client = emptyClient({
      sessions: {
        list: vi.fn(async () => ({ sessions: [session] })),
        setAutonomyMode: setAutonomy,
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["1", "sess-1 autonomous", "q"]),
      output: output.capture,
    });
    expect(setAutonomy).toHaveBeenCalledWith("sess-1", "autonomous");
    expect(output.frames.join("\n")).toMatch(/Updated sess-1/);
  });

  it("never imports `.kota/` paths or module services directly", () => {
    const sources = [
      readFileSync(join(import.meta.dirname, "navigator.ts"), "utf-8"),
      readFileSync(join(import.meta.dirname, "index.ts"), "utf-8"),
    ];
    for (const src of sources) {
      // The navigator must not bypass the KotaClient contract by reading
      // .kota/ on disk, opening its own DaemonControlClient, or pulling
      // module providers/services through ModuleContext.
      expect(/['"]\.kota\//.test(src), "navigator must not read .kota/ paths").toBe(false);
      expect(/DaemonControlClient/.test(src), "navigator must not import DaemonControlClient").toBe(false);
      expect(/getProvider|getModuleSummaries|getApprovalQueue|moduleServices/.test(src),
        "navigator must not resolve module services through ctx",
      ).toBe(false);
    }
  });

  it("surfaces contract errors in place rather than swallowing them", async () => {
    const failingList = vi.fn(async () => {
      throw new Error("Daemon unreachable while listing approvals");
    });
    const client = emptyClient({
      approvals: {
        list: failingList,
        approve: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
        reject: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["4", "q"]),
      output: output.capture,
    });
    expect(output.frames.join("\n")).toMatch(/Daemon unreachable/);
  });
});
