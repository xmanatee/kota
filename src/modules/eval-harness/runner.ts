import { executeIsolatedVerifier } from "./executable-verifier-sandbox.js";
import type { ExecutableVerifier } from "./executable-verifier-types.js";
import { isMultiRoundFixtureSpec } from "./fixture.js";
import { collectFixtureExecutionEvidence } from "./runner-evidence.js";
import { cleanupFixtureWorkingDir } from "./runner-materialize.js";
import { runMultiRoundFixture } from "./runner-multi-fixture.js";
import { runSingleWorkflowFixture } from "./runner-single-fixture.js";
import type { FixtureRunReport, RunFixtureParams } from "./runner-types.js";

export type {
  FixtureRunReport,
  RunFixtureParams,
  WorkflowAgentExecutionOverride,
  WorkflowExecutionOutcome,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "./runner-types.js";
export { cleanupFixtureWorkingDir };

/**
 * Run a single fixture attempt. Single-workflow fixtures get one isolated
 * tmpdir per attempt; multi-round fixtures preserve one tmpdir across their
 * ordered rounds.
 */
export async function runFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  const report = isMultiRoundFixtureSpec(params.fixture.spec)
    ? await runMultiRoundFixture(params)
    : await runSingleWorkflowFixture(params);
  const sandbox = params.executor.predicateContext?.executableVerifierSandbox;
  // Scoring capabilities may overlay trusted files; evidence must see the
  // complete candidate tree, including edits to those same scorer paths.
  const executableVerifier: ExecutableVerifier | undefined = sandbox === undefined
    ? undefined
    : (request) => executeIsolatedVerifier({
        ...request,
        context: {
          sandbox,
          executionProfile: params.executionProfile,
          workspace: { kind: "candidate" },
        },
      });
  report.run.executionEvidence = await collectFixtureExecutionEvidence(report, executableVerifier);
  return report;
}
