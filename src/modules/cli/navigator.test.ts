import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { DaemonSseStreamEvent, InteractiveSession, WorkflowDefinitionSummary } from "#core/daemon/daemon-control.js";
import type { KotaClient } from "#core/server/kota-client.js";
import {
  buildOperatorControlUiSurface,
  type UiAction,
  type UiSurface,
  type UiSurfaceBundle,
} from "#modules/daemon-ops/operator-ui.js";
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

function emptyExplainResult() {
  return {
    graph: {
      workflows: [],
      events: [],
      agents: [],
      automation: {
        workflows: [],
        events: [],
        blockers: [],
        downstream: [],
      },
    },
    query: {},
    outcome: "unknown" as const,
    matches: [],
    reasons: [],
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
      explain: stub(emptyExplainResult()),
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
    inboundSignals: {
      listRoutes: stub({
        routes: [],
        validation: { ok: true, routes: [] },
      }),
      validateRoutes: stub({ ok: true, routes: [] }),
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
    ui: {
      listSurfaces: stub({ protocolVersion: "ui.surface.v1", surfaces: [] }),
      executeAction: stub({ ok: false, reason: "not_found", message: "stub" }),
      watchEvents: async function* () {},
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

function surfaceBundle(): UiSurfaceBundle {
  return {
    protocolVersion: "ui.surface.v1",
    surfaces: [buildOperatorControlUiSurface("scope-main")],
  };
}

function navigationAction(surfaceId: string, actionId: string, label: string): UiAction {
  return {
    surfaceId,
    actionId,
    scopeId: "scope-main",
    label,
    effect: "read",
    operation: { kind: "client-namespace", namespace: "workflow", method: "status" },
    confirmation: { mode: "none" },
    readiness: { state: "ready" },
    result: {
      success: { message: `${label} completed.` },
      errors: [{ reason: "unavailable", message: "Unavailable in test." }],
    },
    permissions: [
      { kind: "effect", effect: "read" },
      { kind: "capability-scope", scope: "read" },
    ],
  };
}

function navigationSurface(args: {
  surfaceId: string;
  title: string;
  intent: UiSurface["intent"];
  order: number;
  actions: readonly UiAction[];
}): UiSurface {
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: args.surfaceId,
    extensionId: `test.${args.surfaceId}`,
    title: args.title,
    intent: args.intent,
    scopeId: "scope-main",
    attachmentPoint: { kind: "intent", intent: args.intent },
    order: args.order,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [{ kind: "text", title: args.title, body: `${args.title} body.` }],
    actions: args.actions,
  };
}

function navigationSurfaceBundle(): UiSurfaceBundle {
  const statusActions = [
    navigationAction("status-panel", "status.refresh", "Refresh status"),
  ];
  const workActions = [
    navigationAction("work-console", "work.first", "First work action"),
    navigationAction("work-console", "work.second", "Second work action"),
  ];
  return {
    protocolVersion: "ui.surface.v1",
    surfaces: [
      navigationSurface({
        surfaceId: "status-panel",
        title: "Status Panel",
        intent: "Status",
        order: 10,
        actions: statusActions,
      }),
      navigationSurface({
        surfaceId: "work-console",
        title: "Work Console",
        intent: "Work",
        order: 20,
        actions: workActions,
      }),
    ],
  };
}

describe("runtime navigator", () => {
  it("refuses non-TTY launch and prints the equivalent one-shot hint", () => {
    let captured = "";
    const stderr = { write: (s: string) => { captured += s; return true; } } as unknown as NodeJS.WritableStream;
    refuseNonTtyLaunch(stderr);
    expect(captured.trim()).toBe(NON_TTY_HINT);
  });

  it("renders shared UI surfaces, opens a Work intent surface, and quits cleanly", async () => {
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["work", "q"]),
      output: output.capture,
    });
    const joined = output.frames.join("\n");
    expect(joined).toMatch(/KOTA CLI client/);
    expect(joined).toMatch(/Daemon-backed shared UI client/);
    expect(joined).toMatch(/operator-control/);
    expect(joined).toMatch(/Operator Control/);
    expect(joined).toMatch(/Launch workflow run/);
    expect(joined).toMatch(/Live daemon events/);
    expect(joined).toMatch(/launch\.defaults\.configure/);
    expect(client.ui.listSurfaces).toHaveBeenCalledTimes(1);
  });

  it("refreshes the shared surface bundle on command", async () => {
    const listSurfaces = vi.fn(async () => surfaceBundle());
    const client = emptyClient({
      ui: {
        listSurfaces,
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["refresh", "q"]),
      output: output.capture,
    });
    expect(listSurfaces).toHaveBeenCalledTimes(2);
    expect(output.frames.join("\n")).toMatch(/operator-control/);
  });

  it("renders command palette, resize, theme, and keybinding states", async () => {
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt([":", "resize 120", "theme ascii", "keys", "q"]),
      output: output.capture,
    });
    const joined = output.frames.join("\n");
    expect(joined).toMatch(/Command palette/);
    expect(joined).toMatch(/Width set to 120/);
    expect(joined).toMatch(/Theme preference set to ascii/);
    expect(joined).toMatch(/Keybindings/);
  });

  it("drives keyboard focus and selected surface/action movement deterministically", async () => {
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => navigationSurfaceBundle()),
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["j", "k", "j", "enter", "tab", "j", "k", "q"]),
      output: output.capture,
    });

    expect(output.frames[0]).toMatch(/focus:surfaces/);
    expect(output.frames[0]).toMatch(/>\s+1\s+status-panel/);
    expect(output.frames[1]).toMatch(/>\s+2\s+work-console/);
    expect(output.frames[2]).toMatch(/>\s+1\s+status-panel/);
    expect(output.frames[3]).toMatch(/>\s+2\s+work-console/);
    expect(output.frames[4]).toMatch(/Work Console/);
    expect(output.frames[4]).toMatch(/>\s+work\.first\s+First work action/);
    expect(output.frames[5]).toMatch(/focus:actions/);
    expect(output.frames[6]).toMatch(/>\s+work\.second\s+Second work action/);
    expect(output.frames[7]).toMatch(/>\s+work\.first\s+First work action/);
  });

  it("subscribes to live daemon UI events and refreshes the current frame", async () => {
    const listSurfaces = vi.fn(async () => surfaceBundle());
    async function* watchEvents(): AsyncIterable<DaemonSseStreamEvent> {
      yield {
        id: "evt-1",
        type: "workflow.started",
        payload: {
          projectId: "scope-main",
          workflow: "builder",
          runId: "run-1",
          triggerEvent: "manual",
          definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
          runDir: ".kota/runs/run-1",
          startedAt: "2026-06-19T00:00:00.000Z",
        },
      };
    }
    const client = emptyClient({
      ui: {
        listSurfaces,
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents,
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: {
        ask: async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return "q";
        },
        close: () => {},
      },
      output: output.capture,
    });
    const joined = output.frames.join("\n");
    expect(listSurfaces).toHaveBeenCalledTimes(2);
    expect(joined).toMatch(/Live update workflow\.started/);
    expect(joined).toMatch(/live:event-stream 1/);
  });

  it("executes a typed shared UI action with JSON parameters", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Workflow queued." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(['action operator-control workflow.launch --yes {"name":"builder"}', "q"]),
      output: output.capture,
    });
    expect(executeAction).toHaveBeenCalledWith({
      surfaceId: "operator-control",
      actionId: "workflow.launch",
      parameters: { name: "builder" },
    });
    expect(output.frames.join("\n")).toMatch(/UI action executed/);
  });

  it("requires confirmation for write actions when --yes is absent", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Workflow queued." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["action operator-control workflow.launch", "Launch run", "q"]),
      output: output.capture,
    });
    expect(executeAction).toHaveBeenCalledWith({
      surfaceId: "operator-control",
      actionId: "workflow.launch",
      parameters: undefined,
    });
    expect(output.frames.join("\n")).toMatch(/UI action executed/);
  });

  it("keeps disabled actions local instead of executing them", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Updated." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["action operator-control launch.defaults.configure --yes {}", "q"]),
      output: output.capture,
    });
    expect(executeAction).not.toHaveBeenCalled();
    expect(output.frames.join("\n")).toMatch(/Configure launch defaults is disabled/);
  });

  it("never imports `.kota/` paths, module services, or private navigator data paths", () => {
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
      expect(/client\.(approvals|tasks|workflow|sessions|modules|setup|secrets|memory|knowledge|history|ownerQuestions)\b/.test(src),
        "navigator must consume shared ui surfaces rather than private namespace projections",
      ).toBe(false);
    }
  });

  it("surfaces contract errors in place rather than swallowing them", async () => {
    const failingList = vi.fn(async () => {
      throw new Error("Daemon unreachable while listing shared UI surfaces");
    });
    const client = emptyClient({
      ui: {
        listSurfaces: failingList,
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["work", "q"]),
      output: output.capture,
    });
    expect(output.frames.join("\n")).toMatch(/Daemon unreachable/);
  });
});
