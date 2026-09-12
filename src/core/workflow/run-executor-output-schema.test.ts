import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRunExecutorTestFixture,
  makeDefinition,
  type RunExecutorTestFixture,
} from "./run-executor-test-fixture.js";

let fixture: RunExecutorTestFixture;

beforeEach(() => {
  fixture = createRunExecutorTestFixture();
});

afterEach(() => {
  fixture.dispose();
});

describe("outputSchema validation", () => {
  it("run succeeds when last step output matches outputSchema", async () => {
    const definition = makeDefinition({
      outputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
      },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ value: 42 }),
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.warnings).toBeUndefined();
  });

  it.each([
    ["wrong property type", { value: "not-a-number" }],
    ["missing required property", { notValue: "oops" }],
  ])("persists an output warning for %s", async (_label, output) => {
    const definition = makeDefinition({
      outputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
      },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => output,
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(result.metadata.warnings).toHaveLength(1);
    expect(result.metadata.warnings?.[0]?.type).toBe("output-schema-mismatch");
    expect(result.metadata.warnings?.[0]?.message).toContain("value");
    expect(fixture.store.getRun(result.metadata.id)).toMatchObject({
      status: "completed-with-warnings",
      warnings: result.metadata.warnings,
    });
  });

  it("run succeeds with no warnings when outputSchema is absent", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ whatever: true }),
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.warnings).toBeUndefined();
  });

  it("output schema is not validated when run fails", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", required: ["value"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => {
            throw new Error("step failed");
          },
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.warnings).toBeUndefined();
  });
});
