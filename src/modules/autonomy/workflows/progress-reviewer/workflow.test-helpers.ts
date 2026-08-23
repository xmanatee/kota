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
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import {
  decodeProgressReviewAgentOutput,
  type ProgressReviewAgentOutput,
} from "./progress-review.js";

export const NOW = new Date("2026-06-04T12:00:00.000Z");

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
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
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
