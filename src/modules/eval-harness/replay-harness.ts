/**
 * Replay agent-harness adapter owned by the eval-harness module.
 *
 * The adapter lets fixture subprocesses exercise agent-call workflow branches
 * without invoking a real LLM. It reads a recording keyed by the current
 * workflow + step from `<fixtureDir>/recordings/<stepId>.json`, applies the
 * recorded post-agent file state to the subprocess working directory, and
 * returns the recorded response envelope as an `AgentHarnessResult`.
 *
 * Selection seam: the adapter registers itself under the `claude-agent-sdk`
 * name when the eval-harness module `onLoad` sees
 * `KOTA_EVAL_HARNESS_REPLAY_ROOT` in the environment — the same env-remap
 * surface the subprocess executor uses for `HOME` and `KOTA_PROJECT_DIR`.
 * Production code paths do not set this env var, so production selection
 * behavior is unchanged. Fixture subprocesses opt in on every run.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  KotaAgentMessage,
} from "#core/agent-harness/types.js";
import {
  type AgentStepFileOperation,
  loadAgentStepRecordings,
} from "./agent-step-recording.js";

export const REPLAY_AGENT_HARNESS_NAME_ENV = "KOTA_EVAL_HARNESS_REPLAY_ROOT";

/**
 * Recording-key discriminator.
 *
 * KOTA issues two shapes of agent call through `claude-agent-sdk`: workflow
 * step executions (generator path) and workflow judge calls (evaluator path,
 * today the builder critic and the improver semantic gate). Each shape has a
 * stable prompt fingerprint the adapter uses to pick the right recording
 * without coupling to a private systemPrompt constant:
 *
 *  - **step**: prompt built by `buildAgentPrompt` in
 *    `src/core/workflow/steps/step-executor-agent.ts`; starts with the fixed
 *    header and declares `Workflow:`, `Step:`, `Run directory:`.
 *  - **judge**: user-message prompts built inside autonomy judges. Each judge
 *    has a unique leading header and a `Run directory:` line inside a
 *    `## Review context` block. Known judges and their recording keys live in
 *    `JUDGE_PROMPT_HEADERS` below; the header is matched first, and the
 *    matching recording key is the judge's repair-check id so each fixture
 *    stores at most one recording per agent call it replays.
 */
type ParsedPromptContext =
  | { kind: "step"; workflow: string; stepId: string; runDir: string }
  | { kind: "judge"; stepId: string; runDir: string };

const STEP_PROMPT_HEADER =
  "Execute one KOTA workflow step in this repository.";

/**
 * Judge-prompt routing table. Entries are matched in order against the
 * trimmed prompt; the first header to match picks the recording id. Adding a
 * new judge is a one-line entry here plus a recording file at
 * `<fixtureDir>/recordings/<recordingId>.json`.
 *
 *  - `critic-review` — `createCriticCheck` in
 *    `src/modules/autonomy/critic.ts`. User message starts with
 *    `## Task (what was asked)`.
 *  - `semantic-gate-review` — `createImproverSemanticCheck` in
 *    `src/modules/autonomy/improver-semantic-gate.ts`. User message starts
 *    with `## Commit message`. The recording id matches the `ARTIFACT_NAME`
 *    the gate writes (`semantic-gate-review.json`), so the recorder's
 *    `--judge <label>` mode can author the recording end-to-end.
 */
const JUDGE_PROMPT_HEADERS: ReadonlyArray<{ header: string; recordingId: string }> = [
  { header: "## Task (what was asked)", recordingId: "critic-review" },
  { header: "## Commit message", recordingId: "semantic-gate-review" },
];

function matchJudgeHeader(prompt: string): string | null {
  const trimmed = prompt.trimStart();
  for (const { header, recordingId } of JUDGE_PROMPT_HEADERS) {
    if (trimmed.startsWith(header)) return recordingId;
  }
  return null;
}

/**
 * Identify which recording a prompt should replay. Step prompts are keyed by
 * the explicit `Step:` line; judge prompts map to their repair-check id so
 * each fixture stores at most one recording per agent call it replays.
 */
function parsePromptContext(prompt: string): ParsedPromptContext {
  if (prompt.startsWith(STEP_PROMPT_HEADER)) {
    const workflow = /^Workflow:\s*(.+)$/m.exec(prompt)?.[1]?.trim();
    const stepId = /^Step:\s*(.+)$/m.exec(prompt)?.[1]?.trim();
    const runDir = /^Run directory:\s*(.+)$/m.exec(prompt)?.[1]?.trim();
    if (!workflow || !stepId || !runDir) {
      const preview = prompt.slice(0, 400);
      throw new Error(
        `eval-harness replay adapter could not parse Workflow/Step/Run directory from the agent prompt (first 400 chars: ${JSON.stringify(preview)}); the prompt shape built by step-executor-agent.ts is load-bearing for replay. This typically means the step invoked a repair-loop retry; fix the underlying repair check so the first replay call is sufficient.`,
      );
    }
    return { kind: "step", workflow, stepId, runDir };
  }
  const recordingId = matchJudgeHeader(prompt);
  if (recordingId !== null) {
    const runDir = /^Run directory:\s*(.+)$/m.exec(prompt)?.[1]?.trim();
    if (!runDir) {
      const preview = prompt.slice(0, 400);
      throw new Error(
        `eval-harness replay adapter detected a judge prompt for recording "${recordingId}" without a "Run directory:" line (first 400 chars: ${JSON.stringify(preview)}); every autonomy judge prompt declares its run directory inside the "## Review context" block.`,
      );
    }
    return { kind: "judge", stepId: recordingId, runDir };
  }
  const preview = prompt.slice(0, 400);
  const knownHeaders = JUDGE_PROMPT_HEADERS.map((e) => `"${e.header}"`).join(", ");
  throw new Error(
    `eval-harness replay adapter does not recognize this agent-prompt shape (first 400 chars: ${JSON.stringify(preview)}). Known shapes: workflow-step prompts built by buildAgentPrompt (leading with "${STEP_PROMPT_HEADER}"), and workflow-judge prompts (leading with one of: ${knownHeaders}).`,
  );
}

function substituteRunDir(path: string, runDir: string): string {
  return path.replaceAll("{{runDir}}", runDir);
}

function applyFileOperation(
  cwd: string,
  runDir: string,
  operation: AgentStepFileOperation,
): string {
  const substituted = substituteRunDir(operation.path, runDir);
  const absolute = resolve(cwd, substituted);
  if (operation.op === "delete") {
    rmSync(absolute, { force: true });
    return substituted;
  }
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, operation.content, "utf-8");
  return substituted;
}

/**
 * Stage the replay's mutations through `git add -A -- <paths>` the same way
 * the real agent's `pnpm kota task {create,move}` calls do in production.
 * Workflows downstream of the agent step (e.g. decomposer's
 * `task-queue-valid` repair check) inspect `git status`; leaving the
 * replay's writes untracked would regress those checks even though the
 * recorded response corresponds to a successful real run.
 *
 * `git add` is a best-effort call — if the fixture runtime did not initialize
 * git (e.g. a fixture with no agent recordings opted out), the add fails
 * silently so production is unaffected. Fixtures that do replay always have
 * git initialized by the eval-harness runner.
 */
function stageReplayMutations(cwd: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  if (!existsSync(join(cwd, ".git"))) return;
  // Dedupe; the same path can appear across multiple operations (delete then
  // write, for example).
  const unique = [...new Set(paths)];
  spawnSync("git", ["add", "-A", "--", ...unique], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Build the replay adapter rooted at a specific recordings directory. The
 * env-gated registration path in `src/modules/eval-harness/index.ts` is the
 * only production caller; tests construct the adapter directly and hand it
 * a fixture directory path.
 */
export function createReplayAgentHarness(recordingsRoot: string): AgentHarness {
  if (!statSync(recordingsRoot).isDirectory()) {
    throw new Error(
      `eval-harness replay adapter root ${JSON.stringify(recordingsRoot)} is not a directory`,
    );
  }

  const recordings = new Map<string, ReturnType<typeof loadAgentStepRecordings>[number]>();
  for (const recording of loadAgentStepRecordings(recordingsRoot)) {
    recordings.set(recording.stepId, recording);
  }

  return {
    name: "claude-agent-sdk",
    description:
      "Eval-harness replay adapter. Overrides the claude-agent-sdk registration inside fixture subprocesses so agent-call branches replay from recorded responses without invoking a real LLM.",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: true,
    async run(
      options: AgentHarnessRunOptions,
    ): Promise<AgentHarnessResult> {
      const context = parsePromptContext(options.prompt);
      const recording = recordings.get(context.stepId);
      if (!recording) {
        throw new Error(
          `eval-harness replay adapter has no recording for step ${JSON.stringify(context.stepId)}; expected "${join(recordingsRoot, "recordings", `${context.stepId}.json`)}".`,
        );
      }
      // Workflow-step calls carry the workflow name in their prompt header and
      // must match the recording's declared workflow; judge calls never name a
      // workflow in their user message, so the recording's workflowName on
      // those is advisory (traceability only) and is not used for dispatch.
      if (context.kind === "step" && recording.workflowName !== context.workflow) {
        throw new Error(
          `eval-harness replay adapter recording for step ${JSON.stringify(context.stepId)} declares workflow ${JSON.stringify(recording.workflowName)} but the current run is workflow ${JSON.stringify(context.workflow)}.`,
        );
      }

      const cwd = options.cwd;
      if (!cwd) {
        throw new Error(
          "eval-harness replay adapter requires options.cwd; agent-step executor always sets it.",
        );
      }

      const mutatedPaths = recording.fileOperations.map((op) =>
        applyFileOperation(cwd, context.runDir, op),
      );
      stageReplayMutations(cwd, mutatedPaths);

      // Emit a synthetic KotaAgentMessage stream frame so the agent-step
      // executor's tool-telemetry tracker and run-artifact appender see a
      // result message. Callers rely on `emitsAgentMessageStream: true` to
      // subscribe; skipping the emission would leave the run-level
      // message log empty in ways production never produces.
      if (options.onMessage) {
        const resultMessage: KotaAgentMessage = {
          type: "result",
          isError: false,
          ...(recording.response.subtype !== undefined && {
            subtype: recording.response.subtype,
          }),
          ...(recording.response.text !== undefined && {
            text: recording.response.text,
          }),
          ...(recording.response.totalCostUsd !== undefined && {
            totalCostUsd: recording.response.totalCostUsd,
          }),
          ...(recording.response.turns !== undefined && {
            numTurns: recording.response.turns,
          }),
          ...(recording.response.inputTokens !== undefined && {
            inputTokens: recording.response.inputTokens,
          }),
          ...(recording.response.outputTokens !== undefined && {
            outputTokens: recording.response.outputTokens,
          }),
          ...(recording.response.sessionId !== undefined && {
            sessionId: recording.response.sessionId,
          }),
        };
        await options.onMessage(resultMessage);
      }

      return {
        text: recording.response.text,
        streamedText: recording.response.text,
        ...(recording.response.sessionId !== undefined && {
          sessionId: recording.response.sessionId,
        }),
        turns: recording.response.turns,
        totalCostUsd: recording.response.totalCostUsd,
        inputTokens: recording.response.inputTokens,
        outputTokens: recording.response.outputTokens,
        subtype: recording.response.subtype,
        isError: false,
      };
    },
  };
}

/**
 * Read the replay root from the environment. Returns `null` when the env
 * var is unset (production selection path) — the eval-harness module uses
 * this to decide whether to overwrite the claude-agent-sdk registration.
 */
export function resolveReplayRootFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env[REPLAY_AGENT_HARNESS_NAME_ENV];
  if (!raw || raw.trim().length === 0) return null;
  return raw.trim();
}

