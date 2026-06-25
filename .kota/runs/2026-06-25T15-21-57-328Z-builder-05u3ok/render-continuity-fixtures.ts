import {
  buildContinuityProjection,
  buildContinuityUiSurface,
  renderUiSurface,
} from "#modules/daemon-ops/operator-ui.js";
import { renderToString } from "#modules/rendering/transport.js";

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

const status = {
  daemonRunning: true,
  activeRuns: 1,
  queuedRuns: 0,
  workflowPaused: false,
  sessions: 1,
  pendingApprovals: 0,
  projectDir: "/repo/kota",
  projectName: "kota",
  scopedProject: {
    projectId: "p-kota-fixture-default",
    displayName: "kota",
    projectDir: "/repo/kota",
  },
  controlFile: { kind: "present" },
  historicalWorkflow: {
    activeRuns: 1,
    queuedRuns: 0,
    workflowPaused: false,
  },
};

const workflowStatus = ok({
  activeRuns: [
    {
      runId: "2026-06-25T10-00-00-000Z-builder-active",
      workflow: "builder",
      startedAt: "2026-06-25T10:00:00.000Z",
    },
  ],
  pendingRuns: [],
  queueLength: 0,
  completedRuns: 8,
  workflows: {},
  paused: false,
  agentConcurrency: 1,
  codeConcurrency: 4,
  pendingAbort: false,
});

const definitions = ok({
  source: "daemon",
  definitions: [
    {
      name: "daily-digest",
      enabled: true,
      stepCount: 2,
      triggers: [{ type: "cron", schedule: "0 9 * * *" }],
    },
  ],
});

const setupReady = ok({
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
});

function baseInput(overrides = {}) {
  return {
    status,
    tasks: ok({
      tasks: [
        {
          id: "task-active-work",
          priority: "p2",
          title: "Improve operator continuity",
          state: "doing",
          waitingOnTasks: [],
        },
      ],
    }),
    workflowStatus,
    runs: ok({
      runs: [
        {
          id: "2026-06-25T09-00-00-000Z-builder-success",
          workflow: "builder",
          status: "success",
          triggerEvent: "autonomy.queue.available",
          triggerSchemaRef: null,
          startedAt: "2026-06-25T09:00:00.000Z",
        },
      ],
    }),
    definitions,
    approvals: ok({ approvals: [] }),
    ownerQuestions: ok({ questions: [] }),
    ownerDecisions: ok({ decisions: [] }),
    setup: setupReady,
    memory: ok({
      entries: [
        {
          id: "mem-continuity",
          created: "2026-06-25T08:00:00.000Z",
          content: "Recent work changed the continuity surface and left review artifacts.",
        },
      ],
    }),
    knowledge: ok({
      entries: [
        {
          id: "kn-continuity",
          title: "Continuity design notes",
          type: "decision",
          tags: ["continuity"],
          status: "active",
          created: "2026-06-25T08:00:00.000Z",
          updated: "2026-06-25T08:00:00.000Z",
          content: "Keep clients on the daemon contract.",
          meta: {},
        },
      ],
    }),
    ...overrides,
  };
}

function renderCase(name: string, input: ReturnType<typeof baseInput>): void {
  const projection = buildContinuityProjection(input);
  const surface = buildContinuityUiSurface(projection);
  console.log(`$ kota ui render continuity --fixture ${name}`);
  console.log(`state=${projection.state}`);
  console.log(`nextAction=${projection.nextAction}`);
  console.log(`composedStores=${projection.composedStores.join(", ")}`);
  console.log(renderToString(renderUiSurface(surface), { width: 118 }));
  console.log("");
}

renderCase("healthy", baseInput());

renderCase("blocked", baseInput({
  tasks: ok({
    tasks: [
      {
        id: "task-blocked",
        priority: "p1",
        title: "Blocked release review",
        state: "blocked",
        waitingOnTasks: [],
      },
    ],
  }),
  approvals: ok({
    approvals: [
      {
        id: "approval-1",
        tool: "shell.exec",
        input: {},
        risk: "dangerous",
        reason: "release command needs approval",
        createdAt: "2026-06-25T08:00:00.000Z",
        status: "pending",
      },
    ],
  }),
  ownerQuestions: ok({
    questions: [
      {
        id: "question-1",
        seq: 1,
        context: "Release review",
        question: "Use production credentials?",
        reason: "High stakes",
        source: "workflow",
        answerBehavior: "workflow-resume",
        origin: {
          kind: "workflow",
          workflowName: "builder",
          runId: "run-1",
          stepId: "build",
          taskId: "task-blocked",
        },
        createdAt: "2026-06-25T08:00:00.000Z",
        status: "pending",
      },
    ],
  }),
  ownerDecisions: ok({
    decisions: [
      {
        id: "decision-1",
        seq: 1,
        scopeId: "p-kota-fixture-default",
        status: "pending",
        request: { kind: "free-text", prompt: "Pick the deployment provider." },
        requester: { kind: "manual", source: "fixture" },
        evidence: [],
        createdAt: "2026-06-25T08:00:00.000Z",
        updatedAt: "2026-06-25T08:00:00.000Z",
      },
    ],
  }),
  setup: ok({
    requirements: [
      {
        moduleName: "telegram",
        requirementId: "bot-credentials",
        kind: "secret",
        title: "Telegram bot credentials",
        required: true,
        scope: "project",
        sensitivity: "secret",
        setup: { mode: "url", url: "https://t.me/BotFather", label: "Open BotFather" },
        state: "missing",
        reason: "secret_missing",
        message: "Required credential is missing",
        secretRefs: [{ name: "TELEGRAM_BOT_TOKEN", scope: "project", present: false }],
      },
    ],
    summary: {
      ready: 0,
      missing: 1,
      pending: 0,
      expired: 0,
      revoked: 0,
      unknown: 0,
      unavailable: 0,
    },
  }),
}));

renderCase("failed", baseInput({
  runs: ok({
    runs: [
      {
        id: "2026-06-25T09-00-00-000Z-builder-failed",
        workflow: "builder",
        status: "failed",
        triggerEvent: "autonomy.queue.available",
        triggerSchemaRef: null,
        startedAt: "2026-06-25T09:00:00.000Z",
      },
    ],
  }),
}));
