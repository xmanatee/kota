import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  detectAndSeedFanOutOperation,
  type FanOutDetectionInspection,
} from "./blocking-operations.js";

const detectAndSeed = typedCodeStep<FanOutDetectionInspection>({
  id: "detect-and-seed",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<FanOutDetectionInspection>(raw, [
      "dirty",
      "artifact",
      "touchedDisk",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(detectAndSeedFanOutOperation, {
      projectDir,
      nowIso: new Date().toISOString(),
    }),
});

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: (ctx) => detectAndSeed.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, ["written", "path"]),
  run: (ctx) => {
    const inspection = detectAndSeed.outputRequired(ctx);
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(ctx.workflow.runDirPath, "fan-out-consolidation.json");
    writeFileSync(artifactPath, `${JSON.stringify(inspection.artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => detectAndSeed.output(ctx)?.touchedDisk === true,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const inspection = detectAndSeed.outputRequired(ctx);
    const created = inspection.artifact.applied.filter((a) => a.kind === "created");
    const lines: string[] = [
      `fan-out-consolidator: seed ${created.length} consolidation review task(s) in ready/`,
      "",
    ];
    for (const apply of created) {
      if (apply.kind !== "created") continue;
      lines.push(`- ${apply.taskId} — capability \`${apply.capabilityKey}\``);
    }
    lines.push("");
    lines.push(
      "Each review task names IA, contract consistency, duplicated rendering, runtime",
    );
    lines.push(
      "evidence, and accepted critic warnings as required Done When dimensions.",
    );
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
    );
    return { written: true };
  },
});

const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: async (ctx) => {
    await ctx.runCommand({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: ctx.projectDir,
    });
    return { ok: true } as const;
  },
});

const fanOutConsolidatorWorkflow: WorkflowDefinitionInput = {
  name: "fan-out-consolidator",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Detect completed multi-client fan-out batches and seed one consolidation review task per new batch in ready/.",
  tags: ["monitored"],
  triggers: [
    {
      event: "workflow.completed",
      filter: { workflow: ["builder"], status: ["success", "completed-with-warnings"] },
      queueMode: "all",
    },
  ],
  steps: [
    detectAndSeed,
    writeArtifact,
    writeCommitMessage,
    validateChanges,
  ],
};

export default fanOutConsolidatorWorkflow;
