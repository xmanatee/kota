import { describe, expect, it } from "vitest";
import {
  type TriggerField,
  assembleTriggerPayload,
  emptyDraft,
  parseTriggerFields,
} from "./workflow-trigger-schema";

describe("parseTriggerFields", () => {
  it("returns an empty list for an absent schema", () => {
    expect(parseTriggerFields(undefined)).toEqual([]);
  });

  it("returns an empty list for a schema without properties", () => {
    expect(parseTriggerFields({ type: "object" })).toEqual([]);
  });

  it("preserves property order, marks required, and falls back unknown leaf types to text", () => {
    const fields = parseTriggerFields({
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task to decompose" },
        maxChildren: { type: "number" },
        includeBlocked: { type: "boolean" },
        meta: { type: "object" },
      },
      required: ["taskId", "maxChildren"],
    });
    expect(fields).toEqual<TriggerField[]>([
      {
        name: "taskId",
        type: "string",
        required: true,
        description: "Task to decompose",
      },
      { name: "maxChildren", type: "number", required: true },
      { name: "includeBlocked", type: "boolean", required: false },
      { name: "meta", type: "unknown", required: false },
    ]);
  });

  it("ignores non-string entries in required", () => {
    const fields = parseTriggerFields({
      properties: { a: { type: "string" } },
      required: ["a", 7],
    });
    expect(fields).toEqual<TriggerField[]>([
      { name: "a", type: "string", required: true },
    ]);
  });
});

describe("emptyDraft", () => {
  it("seeds string/number/unknown fields with '' and boolean fields with false", () => {
    const fields = parseTriggerFields({
      properties: {
        a: { type: "string" },
        b: { type: "number" },
        c: { type: "boolean" },
        d: { type: "object" },
      },
    });
    expect(emptyDraft(fields)).toEqual({ a: "", b: "", c: false, d: "" });
  });
});

describe("assembleTriggerPayload", () => {
  const fields = parseTriggerFields({
    properties: {
      taskId: { type: "string" },
      maxChildren: { type: "number" },
      includeBlocked: { type: "boolean" },
    },
    required: ["taskId"],
  });

  it("returns the typed payload when required fields are present and numbers parse", () => {
    const result = assembleTriggerPayload(fields, {
      taskId: "task-x",
      maxChildren: "5",
      includeBlocked: true,
    });
    expect(result).toEqual({
      ok: true,
      payload: { taskId: "task-x", maxChildren: 5, includeBlocked: true },
    });
  });

  it("omits optional empty fields from the payload", () => {
    const result = assembleTriggerPayload(fields, {
      taskId: "task-x",
      maxChildren: "",
      includeBlocked: false,
    });
    expect(result).toEqual({
      ok: true,
      payload: { taskId: "task-x", includeBlocked: false },
    });
  });

  it("flags missing required fields", () => {
    const result = assembleTriggerPayload(fields, {
      taskId: "",
      maxChildren: "",
      includeBlocked: false,
    });
    expect(result).toEqual({
      ok: false,
      errors: { taskId: "Required." },
    });
  });

  it("flags unparseable numbers", () => {
    const result = assembleTriggerPayload(fields, {
      taskId: "task-x",
      maxChildren: "not-a-number",
      includeBlocked: false,
    });
    expect(result).toEqual({
      ok: false,
      errors: { maxChildren: "Expected a number." },
    });
  });
});
