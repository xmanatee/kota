import { describe, expect, it } from "vitest";
import { CaptureProviderImpl } from "./capture-provider.js";
import type {
  CaptureClassifier,
  CaptureContributor,
  CaptureRecord,
  CaptureTarget,
} from "./capture-types.js";
import { captureTool, createCaptureToolRunner } from "./tool.js";

function fixedContributor(
  target: CaptureTarget,
  record: CaptureRecord,
): CaptureContributor {
  return {
    target,
    async capture() {
      return record;
    },
  };
}

function fixedClassifier(
  result: { kind: "confident"; target: CaptureTarget } | { kind: "ambiguous" },
): CaptureClassifier {
  return {
    async classify() {
      return result;
    },
  };
}

const memRecord: CaptureRecord = { target: "memory", recordId: "mem-42" };
const taskRecord: CaptureRecord = {
  target: "tasks",
  recordId: "task-x",
  path: "data/tasks/backlog/task-x.md",
};

describe("capture tool — schema", () => {
  it("declares a JSON schema with `text` required and the four targets enumerated", () => {
    expect(captureTool.name).toBe("capture");
    expect(captureTool.input_schema.type).toBe("object");
    expect(captureTool.input_schema.required).toEqual(["text"]);
    const props = captureTool.input_schema.properties as Record<string, { enum?: string[] }>;
    expect(props.text).toBeDefined();
    expect(props.target.enum).toEqual(["memory", "knowledge", "tasks", "inbox"]);
    expect(props.hint).toBeDefined();
  });
});

describe("capture tool — runner success arms", () => {
  it("dispatches to the explicit target and renders the success body", async () => {
    const provider = new CaptureProviderImpl();
    provider.register(fixedContributor("memory", memRecord));
    const runner = createCaptureToolRunner(() => provider);

    const result = await runner({ text: "Note about projects", target: "memory" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("Captured: memory  mem-42");
  });

  it("uses the classifier when no target is supplied", async () => {
    const provider = new CaptureProviderImpl({
      classifier: fixedClassifier({ kind: "confident", target: "tasks" }),
    });
    provider.register(fixedContributor("memory", memRecord));
    provider.register(fixedContributor("tasks", taskRecord));
    const runner = createCaptureToolRunner(() => provider);

    const result = await runner({ text: "Audit something tomorrow" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe(
      "Captured: tasks  task-x  data/tasks/backlog/task-x.md",
    );
  });
});

describe("capture tool — runner failure arms", () => {
  it("surfaces the ambiguous envelope as an error result with suggestions", async () => {
    const provider = new CaptureProviderImpl({
      classifier: fixedClassifier({ kind: "ambiguous" }),
    });
    provider.register(fixedContributor("memory", memRecord));
    provider.register(fixedContributor("tasks", taskRecord));
    const runner = createCaptureToolRunner(() => provider);

    const result = await runner({ text: "vague" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Ambiguous capture");
    expect(result.content).toContain("memory");
    expect(result.content).toContain("tasks");
  });

  it("rejects an invalid `target` enum value with a typed error before reaching the provider", async () => {
    const provider = new CaptureProviderImpl();
    provider.register(fixedContributor("memory", memRecord));
    const runner = createCaptureToolRunner(() => provider);

    const result = await runner({ text: "x", target: "not-a-real-store" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("`target` must be one of");
  });

  it("rejects a non-string `text` value with a typed error", async () => {
    const provider = new CaptureProviderImpl();
    const runner = createCaptureToolRunner(() => provider);

    const result = await runner({ text: 42 as unknown as string });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("`text` must be a string");
  });
});
