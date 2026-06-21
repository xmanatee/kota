
import { isMultiRoundFixtureSpec, isSkillAblationFixtureSpec } from "./fixture.js";
import { cleanupFixtureWorkingDir } from "./runner-materialize.js";
import { runMultiRoundFixture } from "./runner-multi-fixture.js";
import { runSingleWorkflowFixture } from "./runner-single-fixture.js";
import { runSkillAblationFixture } from "./runner-skill-fixture.js";
import type { FixtureRunReport, RunFixtureParams } from "./runner-types.js";

export type {
  FixtureRunReport,
  RunFixtureParams,
  WorkflowExecutionOutcome,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "./runner-types.js";
export { cleanupFixtureWorkingDir };

/**
 * Run a single fixture attempt. Single-workflow fixtures get one isolated
 * tmpdir per attempt; multi-round fixtures preserve one tmpdir across their
 * ordered rounds; skill-ablation fixtures get one parent tmpdir containing
 * one isolated materialized workspace per variant.
 */
export async function runFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  if (isMultiRoundFixtureSpec(params.fixture.spec)) {
    return runMultiRoundFixture(params);
  }
  if (isSkillAblationFixtureSpec(params.fixture.spec)) {
    return runSkillAblationFixture(params);
  }
  return runSingleWorkflowFixture(params);
}
