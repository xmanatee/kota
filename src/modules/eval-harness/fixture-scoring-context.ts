import {
  type ExecutableVerifierSandbox,
  executeIsolatedVerifier,
} from "./executable-verifier-sandbox.js";
import type { LoadedFixture } from "./fixture.js";
import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import type { PredicateEvaluationContext } from "./predicates.js";

export type FixtureScoringCapabilities = PredicateEvaluationContext & {
  executableVerifierSandbox?: ExecutableVerifierSandbox;
};

export function fixtureScoringContext(params: {
  capabilities?: FixtureScoringCapabilities;
  fixture: LoadedFixture;
  executionProfile: ExecutionProfilePreflightResult;
}): PredicateEvaluationContext {
  if (params.capabilities?.executableVerifier !== undefined) {
    return params.capabilities;
  }
  const sandbox = params.capabilities?.executableVerifierSandbox;
  if (sandbox === undefined) return params.capabilities ?? {};
  return {
    ...params.capabilities,
    executableVerifier: (request) =>
      executeIsolatedVerifier({
        ...request,
        context: {
          sandbox,
          executionProfile: params.executionProfile,
          trustedVerifierRoot: params.fixture.initialStateDir,
        },
      }),
  };
}
