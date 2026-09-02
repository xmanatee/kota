import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("run is completed-with-warnings when last step output mismatches outputSchema", async () => {
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
          run: () => ({ value: "not-a-number" }),
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(result.metadata.warnings).toHaveLength(1);
    expect(result.metadata.warnings?.[0]?.type).toBe("output-schema-mismatch");
    expect(result.metadata.warnings?.[0]?.message).toContain("value");
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

  it("output schema mismatch warning is persisted in metadata.json", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", required: ["name"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ notName: "oops" }),
        },
      ],
    });

    await fixture.execute(definition).promise;

    const runDirs = readdirSync(join(fixture.workspaceRoot, ".kota", "runs"));
    const metadata = JSON.parse(
      readFileSync(
        join(fixture.workspaceRoot, ".kota", "runs", runDirs[0], "metadata.json"),
        "utf-8",
      ),
    ) as { status: string; warnings?: Array<{ type: string; message: string }> };

    expect(metadata.status).toBe("completed-with-warnings");
    expect(metadata.warnings).toHaveLength(1);
    expect(metadata.warnings?.[0]?.type).toBe("output-schema-mismatch");
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
