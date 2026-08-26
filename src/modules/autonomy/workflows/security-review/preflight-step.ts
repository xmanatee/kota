import { checkRunCommitMessage } from "#core/workflow/run-commit-message.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { taskQueueValidationOperation } from "#modules/repo-tasks/task-queue-validation-operation.js";
import { writeCommitMessage } from "./finding-steps.js";
import { writeJsonArtifact } from "./security-review.js";

type PreflightRail =
  | "task-validation"
  | "commit-message";

type PreflightCheck = {
  rail: PreflightRail;
  status: "passed" | "failed";
  message: string;
};

function writePreflightArtifact(
  runDirPath: string,
  checks: PreflightCheck[],
): string {
  const failed = checks.find((check) => check.status === "failed");
  return writeJsonArtifact(runDirPath, "security-review-preflight.json", {
    ok: failed === undefined,
    checks,
    ...(failed ? { blockedBy: failed.rail } : {}),
  });
}

async function runPreflightRail(
  checks: PreflightCheck[],
  rail: PreflightRail,
  run: () => string | Promise<string>,
): Promise<void> {
  try {
    checks.push({ rail, status: "passed", message: await run() });
  } catch (error) {
    checks.push({
      rail,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const validateChanges = typedCodeStep<{
  ok: true;
  artifactPath: string;
}>({
  id: "validate-changes",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const object = expectStructuredOutput<{ ok: true; artifactPath: string }>(
      raw,
      ["ok", "artifactPath"],
    );
    if (object.ok !== true) {
      throw new Error(`expected ok: true, got ${String(object.ok)}`);
    }
    return object;
  },
  run: async (ctx) => {
    const checks: PreflightCheck[] = [];
    try {
      await runPreflightRail(checks, "task-validation", async () => {
        await ctx.runBlocking(taskQueueValidationOperation, {
          projectDir: ctx.projectDir,
        });
        return "OK: task queue valid";
      });
      await runPreflightRail(checks, "commit-message", () =>
        checkRunCommitMessage(ctx.workflow.runDirPath),
      );
      return {
        ok: true,
        artifactPath: writePreflightArtifact(ctx.workflow.runDirPath, checks),
      } as const;
    } catch (error) {
      const artifactPath = writePreflightArtifact(ctx.workflow.runDirPath, checks);
      throw new Error(
        `security-review preflight failed; diagnostics written to ${artifactPath}`,
        { cause: error },
      );
    }
  },
});
