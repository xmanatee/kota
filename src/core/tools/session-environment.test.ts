import { afterEach, describe, expect, it } from "vitest";
import {
  injectSessionEnvironmentVariable,
  registerSessionEnvironment,
  registerSessionEnvironmentResource,
  sessionEnvironmentForExecution,
  sessionEnvironmentVersionForExecution,
  unregisterSessionEnvironment,
} from "./session-environment.js";

const sessionAProjectA = { sessionId: "session-a", scopeId: "project-a" };
const sessionBProjectA = { sessionId: "session-b", scopeId: "project-a" };
const sessionAProjectB = { sessionId: "session-a", scopeId: "project-b" };

describe("session credential environments", () => {
  afterEach(() => {
    unregisterSessionEnvironment(sessionAProjectA);
    unregisterSessionEnvironment(sessionBProjectA);
    unregisterSessionEnvironment(sessionAProjectB);
  });

  it("isolates credentials by both session and project", () => {
    registerSessionEnvironment(sessionAProjectA);
    registerSessionEnvironment(sessionBProjectA);
    registerSessionEnvironment(sessionAProjectB);

    injectSessionEnvironmentVariable(
      sessionAProjectA,
      "KOTA_SESSION_SECRET",
      "session-a-project-a-value",
    );

    expect(sessionEnvironmentForExecution(sessionAProjectA)).toEqual({
      KOTA_SESSION_SECRET: "session-a-project-a-value",
    });
    expect(sessionEnvironmentForExecution(sessionBProjectA)).toEqual({});
    expect(sessionEnvironmentForExecution(sessionAProjectB)).toEqual({});
  });

  it("keeps runtime session identity separate from workflow trace identity", () => {
    const context = {
      ...sessionAProjectA,
      projectId: sessionAProjectA.scopeId,
      workflow: {
        workflowName: "builder",
        runId: "run-1",
        stepId: "build",
        spanId: "run-1:build",
        scopeId: sessionAProjectA.scopeId,
        projectId: sessionAProjectA.scopeId,
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

  it("erases credentials and rejects stale approvals after teardown", () => {
    registerSessionEnvironment(sessionAProjectA);
    injectSessionEnvironmentVariable(
      sessionAProjectA,
      "KOTA_SESSION_SECRET",
      "temporary-value",
    );

    unregisterSessionEnvironment(sessionAProjectA);

    expect(sessionEnvironmentForExecution(sessionAProjectA)).toEqual({});
    expect(() =>
      injectSessionEnvironmentVariable(
        sessionAProjectA,
        "KOTA_SESSION_SECRET",
        "stale-value",
      )
    ).toThrow("Credential injection requires a live session");
  });

  it("invalidates and cleans up long-lived execution resources", () => {
    registerSessionEnvironment(sessionAProjectA);
    const initialVersion = sessionEnvironmentVersionForExecution(
      sessionAProjectA,
    );
    let cleaned = false;
    registerSessionEnvironmentResource(sessionAProjectA, () => {
      cleaned = true;
    });

    injectSessionEnvironmentVariable(
      sessionAProjectA,
      "KOTA_SESSION_SECRET",
      "temporary-value",
    );

    expect(sessionEnvironmentVersionForExecution(sessionAProjectA)).not.toBe(
      initialVersion,
    );
    unregisterSessionEnvironment(sessionAProjectA);
    expect(cleaned).toBe(true);
  });

  it("rejects malformed or conflicting execution identities", () => {
    expect(() =>
      registerSessionEnvironment({
        sessionId: "session-a",
        scopeId: "project-a",
        projectId: "project-b",
      })
    ).toThrow("Session environment scope id values conflict");

    registerSessionEnvironment(sessionAProjectA);
    expect(() =>
      injectSessionEnvironmentVariable(
        sessionAProjectA,
        "NOT-A-VARIABLE",
        "value",
      )
    ).toThrow("is not a valid environment variable");
  });
});
