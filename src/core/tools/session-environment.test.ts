import { afterEach, describe, expect, it } from "vitest";
import {
  injectSessionEnvironmentVariable,
  registerSessionEnvironment,
  registerSessionEnvironmentResource,
  sessionEnvironmentForExecution,
  sessionEnvironmentVersionForExecution,
  unregisterSessionEnvironment,
} from "./session-environment.js";

const sessionAScopeA = { sessionId: "session-a", scopeId: "scope-a" };
const sessionBScopeA = { sessionId: "session-b", scopeId: "scope-a" };
const sessionAScopeB = { sessionId: "session-a", scopeId: "scope-b" };

describe("session credential environments", () => {
  afterEach(async () => {
    await unregisterSessionEnvironment(sessionAScopeA);
    await unregisterSessionEnvironment(sessionBScopeA);
    await unregisterSessionEnvironment(sessionAScopeB);
  });

  it("isolates credentials by both session and project", () => {
    registerSessionEnvironment(sessionAScopeA);
    registerSessionEnvironment(sessionBScopeA);
    registerSessionEnvironment(sessionAScopeB);

    injectSessionEnvironmentVariable(
      sessionAScopeA,
      "KOTA_SESSION_SECRET",
      "session-a-scope-a-value",
    );

    expect(sessionEnvironmentForExecution(sessionAScopeA)).toEqual({
      KOTA_SESSION_SECRET: "session-a-scope-a-value",
    });
    expect(sessionEnvironmentForExecution(sessionBScopeA)).toEqual({});
    expect(sessionEnvironmentForExecution(sessionAScopeB)).toEqual({});
  });

  it("keeps runtime session identity separate from workflow trace identity", () => {
    const context = {
      ...sessionAScopeA,
      scopeId: sessionAScopeA.scopeId,
      workflow: {
        workflowName: "builder",
        runId: "run-1",
        stepId: "build",
        spanId: "run-1:build",
        scopeId: sessionAScopeA.scopeId,
      },
    };
    registerSessionEnvironment(context);
    injectSessionEnvironmentVariable(
      context,
      "KOTA_SESSION_SECRET",
      "runtime-session-value",
    );

    expect(sessionEnvironmentForExecution(context)).toEqual({
      KOTA_SESSION_SECRET: "runtime-session-value",
    });
  });

  it("erases credentials and rejects stale approvals after teardown", async () => {
    registerSessionEnvironment(sessionAScopeA);
    injectSessionEnvironmentVariable(
      sessionAScopeA,
      "KOTA_SESSION_SECRET",
      "temporary-value",
    );

    await unregisterSessionEnvironment(sessionAScopeA);

    expect(sessionEnvironmentForExecution(sessionAScopeA)).toEqual({});
    expect(() =>
      injectSessionEnvironmentVariable(
        sessionAScopeA,
        "KOTA_SESSION_SECRET",
        "stale-value",
      )
    ).toThrow("Credential injection requires a live session");
  });

  it("invalidates and awaits long-lived execution resources", async () => {
    registerSessionEnvironment(sessionAScopeA);
    const initialVersion = sessionEnvironmentVersionForExecution(
      sessionAScopeA,
    );
    let cleaned = false;
    registerSessionEnvironmentResource(sessionAScopeA, async () => {
      await Promise.resolve();
      cleaned = true;
    });

    injectSessionEnvironmentVariable(
      sessionAScopeA,
      "KOTA_SESSION_SECRET",
      "temporary-value",
    );

    expect(sessionEnvironmentVersionForExecution(sessionAScopeA)).not.toBe(
      initialVersion,
    );
    await unregisterSessionEnvironment(sessionAScopeA);
    expect(cleaned).toBe(true);
  });

  it("rejects malformed environment variable names", () => {
    registerSessionEnvironment(sessionAScopeA);
    expect(() =>
      injectSessionEnvironmentVariable(
        sessionAScopeA,
        "NOT-A-VARIABLE",
        "value",
      )
    ).toThrow("is not a valid environment variable");
  });
});
