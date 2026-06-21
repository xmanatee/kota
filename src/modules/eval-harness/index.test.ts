import { describe, expect, it } from "vitest";
import { CODE_HEALTH_WARNING_CODES as directCodeHealthWarningCodes } from "./code-health-diagnostics.js";
import { runEvalSet as directRunEvalSet } from "./eval-set.js";
import { FixtureProvenanceError as directFixtureProvenanceError } from "./fixture.js";
import evalHarnessModule, {
  CODE_HEALTH_WARNING_CODES,
  FixtureProvenanceError,
  runEvalSet,
} from "./index.js";

describe("eval-harness module entrypoint", () => {
  it("keeps the default module contribution on the entrypoint", () => {
    expect(evalHarnessModule.name).toBe("eval-harness");
    expect(evalHarnessModule.commands).toBeTypeOf("function");
    expect(evalHarnessModule.routes).toBeTypeOf("function");
    expect(evalHarnessModule.daemonClient).toBeTypeOf("function");
  });

  it("re-exports the explicit public surface from the entrypoint", () => {
    expect(runEvalSet).toBe(directRunEvalSet);
    expect(CODE_HEALTH_WARNING_CODES).toBe(directCodeHealthWarningCodes);
    expect(FixtureProvenanceError).toBe(directFixtureProvenanceError);
  });
});
