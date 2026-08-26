import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentHarness,
  type AgentHarnessRunOptions,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { getPreset, SHIPPED_DEFAULT_PRESET_ID } from "#core/model/preset.js";
import type { RunContext } from "#core/workflow/run-context.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import { progressReviewRequested } from "./events.js";
import {
  decodeProgressReviewAgentOutput,
  type ProgressReviewAgentEvidencePacket,
  type ProgressReviewAgentOutput,
} from "./progress-review.js";
import progressReviewerWorkflow from "./workflow.js";

export const NOW = new Date("2026-06-04T12:00:00.000Z");
const TEST_PRESET = getPreset(SHIPPED_DEFAULT_PRESET_ID);

export function readProgressReviewFixture(name: string): ProgressReviewAgentOutput {
  return decodeProgressReviewAgentOutput(
    JSON.parse(
      readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf-8"),
    ),
  );
}

type ReviewFindingGroupInput = Partial<
  ProgressReviewAgentOutput["findings"]["localScope"]
>;

export function reviewOutput(args: {
  verdict: ProgressReviewAgentOutput["verdict"];
  summary: string;
  crossScope?: ReviewFindingGroupInput;
  localScope?: ReviewFindingGroupInput;
  ownerQuestions?: ProgressReviewAgentOutput["ownerQuestions"];
}): ProgressReviewAgentOutput {
  return {
    verdict: args.verdict,
    summary: args.summary,
    findings: {
      crossScope: {
        claims: [],
        followUpTasks: [],
        ...args.crossScope,
      },
      localScope: {
        claims: [],
        followUpTasks: [],
        ...args.localScope,
      },
    },
    ownerQuestions: args.ownerQuestions ?? [],
  };
}

export function makeProgressReviewProjectDir(label = "progress-reviewer"): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `kota-${label}-`)));
  writeFileSync(
    join(dir, ".gitignore"),
    [
      "/.kota/*",
      "!/.kota/runs/",
      "/.kota/runs/*",
      "!/.kota/runs/*/",
      "/.kota/runs/*/*",
      "!/.kota/runs/*/evidence/",
      "!/.kota/runs/*/evidence/**",
      "",
    ].join("\n"),
  );
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

export function makeProgressReviewRunContext(
  projectDir: string,
  runId: string,
): RunContext {
  const runtimeDir = join(projectDir, ".kota", "runtime", runId);
  const tempDir = join(runtimeDir, "temp");
  const artifactDir = join(runtimeDir, "artifacts");
  const agentDir = join(runtimeDir, "agent");
  const packageCacheDir = join(tempDir, "package-cache");
  for (const dir of [tempDir, artifactDir, agentDir, packageCacheDir]) {
    mkdirSync(dir, { recursive: true });
  }
  const signal = new AbortController().signal;
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    project: {
      id: deriveDirectoryScopeId(projectDir),
      root: projectDir,
    },
    workflow: "progress-reviewer",
    trigger: {
      event: progressReviewRequested.name,
      schemaRef: null,
      payload: {},
    },
    sandbox: {
      runId,
      repository: "write",
      rootDir: runtimeDir,
      workspaceDir: projectDir,
      tempDir,
      artifactDir,
      baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim(),
      branch: `test/${runId}`,
      targetBranch: execFileSync(
        "git",
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        { cwd: projectDir, encoding: "utf-8" },
      ).trim(),
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir: projectDir,
      runDir: runtimeDir,
      tempDir,
      artifactDir,
      agentDir,
      packageCacheDir,
      ports: { start: 45_000, end: 45_000, size: 1, values: [45_000] },
      env: {},
    },
    signal,
    processes: { register: () => {} },
    effects: {
      execute: async ({ execute }) => execute(),
    },
    publications: { stageEmit: () => {} },
    state: {
      read: () => ({ revision: 0, value: null }),
      compareAndSet: () => {},
    },
  };
}

export function commitProgressReviewFixture(
  projectDir: string,
  message: string,
  committedAt: string,
): string {
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "--quiet", "-m", message], {
    cwd: projectDir,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: committedAt,
      GIT_COMMITTER_DATE: committedAt,
    },
  });
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim();
}

export function writeProgressReviewTask(
  projectDir: string,
  state: string,
  id: string,
): void {
  const timestamp = NOW.toISOString();
  writeFileSync(
    join(projectDir, "data", "tasks", state, `${id}.md`),
    `---
id: ${id}
title: ${id}
status: ${state}
priority: p2
area: autonomy
summary: ${id} summary
created_at: ${timestamp}
updated_at: ${timestamp}
---

## Problem

Review fixture problem.

## Desired Outcome

Review fixture outcome.

## Constraints

- Keep evidence cited.

## Done When

- Done.

## Source / Intent

Progress reviewer test fixture.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Test fixture.
`,
  );
}

export function registerProgressReviewHarness(run: AgentHarness["run"]): void {
  registerAgentHarness({
    name: TEST_PRESET.harness,
    description: "progress-reviewer workflow test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    run,
  });
}

export function compileProgressReviewerWorkflow() {
  return validateWorkflowDefinitions(
    [
      registerWorkflowDefinition(
        "src/modules/autonomy/workflows/progress-reviewer/workflow.ts",
        progressReviewerWorkflow,
      ),
    ],
    undefined,
    { defaultAgentHarness: TEST_PRESET.harness, preset: TEST_PRESET },
  )[0]!;
}

export function parseReviewInputFromAgentPrompt(
  options: AgentHarnessRunOptions,
): ProgressReviewAgentEvidencePacket {
  const match = options.prompt.match(
    /<step id="prepare-review-input">\n([\s\S]*?)\n<\/step>/,
  );
  if (!match) throw new Error("expected prepare-review-input in agent prompt");
  if (options.prompt.includes('<step id="collect-evidence">')) {
    throw new Error("collect-evidence must not be exposed to the agent");
  }
  return JSON.parse(match[1]!) as ProgressReviewAgentEvidencePacket;
}

export function channelBatchPayload(projectDir: string): WorkflowBatchFlushPayload {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return {
    scopeId,
    projectId: scopeId,
    sourceEventName: inboundSignalReceived.name,
    groupingKey: "channel=slack;sourceId=C123",
    reason: "count",
    count: 2,
    window: {
      firstEventAt: "2026-06-04T11:55:00.000Z",
      lastEventAt: "2026-06-04T11:56:00.000Z",
      flushedAt: NOW.toISOString(),
    },
    inputEvents: [
      {
        event: inboundSignalReceived.name,
        schemaRef: {
          name: inboundSignalReceived.name,
          version: inboundSignalReceived.schema.currentVersion,
        },
        receivedAt: "2026-06-04T11:55:00.000Z",
        payload: {
          scopeId,
          projectId: scopeId,
          provider: "slack",
          channel: "slack",
          accountId: "workspace",
          sourceId: "C123",
          sourceUrl: "https://slack.example/C123",
          externalId: "m1",
          occurredAt: "2026-06-04T11:55:00.000Z",
          receivedAt: "2026-06-04T11:55:00.000Z",
          actor: {
            id: "U1",
            displayName: "Owner",
            trust: "trusted",
            trustReason: "test fixture",
          },
          body: {
            kind: "message",
            format: "plain",
            text: "review this channel scope",
          },
        },
      },
      {
        event: inboundSignalReceived.name,
        schemaRef: {
          name: inboundSignalReceived.name,
          version: inboundSignalReceived.schema.currentVersion,
        },
        receivedAt: "2026-06-04T11:56:00.000Z",
        payload: {
          scopeId,
          projectId: scopeId,
          provider: "slack",
          channel: "slack",
          accountId: "workspace",
          sourceId: "C123",
          sourceUrl: "https://slack.example/C123",
          externalId: "m2",
          occurredAt: "2026-06-04T11:56:00.000Z",
          receivedAt: "2026-06-04T11:56:00.000Z",
          actor: {
            id: "U1",
            displayName: "Owner",
            trust: "trusted",
            trustReason: "test fixture",
          },
          body: {
            kind: "message",
            format: "plain",
            text: "second message",
          },
        },
      },
    ],
    batch: {
      workflow: "progress-reviewer",
      triggerIndex: 4,
      maxBufferSize: 30,
      overflow: "flush-oldest",
      droppedInputCount: 0,
    },
  };
}
