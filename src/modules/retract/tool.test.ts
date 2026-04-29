import { describe, expect, it } from "vitest";
import { RetractProviderImpl } from "./retract-provider.js";
import type { RetractContributor } from "./retract-types.js";
import { createRetractToolDef, createRetractToolRunner, retractTool } from "./tool.js";

function memoryContrib(found: boolean): RetractContributor {
  return {
    target: "memory",
    async retract({ id }) {
      if (!found) return { kind: "not_found", identifier: id };
      return {
        kind: "removed",
        record: { target: "memory", recordId: id },
      };
    },
  };
}

describe("retract tool — schema", () => {
  it("declares the four targets enumerated and `target` required", () => {
    expect(retractTool.name).toBe("retract");
    expect(retractTool.input_schema.type).toBe("object");
    expect(retractTool.input_schema.required).toEqual(["target"]);
    const props = retractTool.input_schema.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(props.target.enum).toEqual(["memory", "knowledge", "tasks", "inbox"]);
    expect(props.id).toBeDefined();
    expect(props.slug).toBeDefined();
    expect(props.path).toBeDefined();
  });

  it("declares a destructive effect on the ToolDef", () => {
    const def = createRetractToolDef(() => new RetractProviderImpl());
    expect(def.effect.kind).toBe("destructive");
  });
});

describe("retract tool — runner success arms", () => {
  it("retracts a memory entry and renders the typed success body", async () => {
    const provider = new RetractProviderImpl();
    provider.register(memoryContrib(true));
    const runner = createRetractToolRunner(() => provider);

    const result = await runner({ target: "memory", id: "mem-42" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("Retracted: memory  mem-42");
  });

  it("retracts a task and renders the moved-to-dropped body", async () => {
    const provider = new RetractProviderImpl();
    provider.register({
      target: "tasks",
      async retract() {
        return {
          kind: "removed",
          record: {
            target: "tasks",
            recordId: "task-x",
            previousPath: "data/tasks/backlog/task-x.md",
            path: "data/tasks/dropped/task-x.md",
            toState: "dropped",
          },
        };
      },
    });
    const runner = createRetractToolRunner(() => provider);
    const result = await runner({ target: "tasks", id: "task-x" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe(
      "Retracted: tasks  task-x  data/tasks/backlog/task-x.md -> data/tasks/dropped/task-x.md (dropped)",
    );
  });
});

describe("retract tool — runner failure arms", () => {
  it("rejects an invalid `target` enum before reaching the provider", async () => {
    const provider = new RetractProviderImpl();
    provider.register(memoryContrib(true));
    const runner = createRetractToolRunner(() => provider);
    const result = await runner({ target: "garbage" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("`target` must be one of");
  });

  it("rejects a memory request without `id`", async () => {
    const provider = new RetractProviderImpl();
    provider.register(memoryContrib(true));
    const runner = createRetractToolRunner(() => provider);
    const result = await runner({ target: "memory" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("memory target requires `id`");
  });

  it("rejects a memory request that also passes `slug`", async () => {
    const provider = new RetractProviderImpl();
    provider.register(memoryContrib(true));
    const runner = createRetractToolRunner(() => provider);
    const result = await runner({
      target: "memory",
      id: "mem-1",
      slug: "k",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("memory target takes `id` only");
  });

  it("surfaces the not_found envelope as an error result", async () => {
    const provider = new RetractProviderImpl();
    provider.register(memoryContrib(false));
    const runner = createRetractToolRunner(() => provider);
    const result = await runner({ target: "memory", id: "missing" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Retract memory: no record with identifier "missing"');
  });

  it("surfaces the no_contributors envelope as an error result", async () => {
    const provider = new RetractProviderImpl();
    const runner = createRetractToolRunner(() => provider);
    const result = await runner({ target: "knowledge", slug: "anything" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain(
      "Cross-store retract has no registered contributors",
    );
  });
});
