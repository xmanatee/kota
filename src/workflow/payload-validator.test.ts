import { describe, expect, it } from "vitest";
import { validatePayloadSchema } from "./payload-validator.js";

describe("validatePayloadSchema", () => {
  it("accepts any payload when schema is empty object", () => {
    expect(validatePayloadSchema({}, { foo: 1 })).toBeNull();
  });

  it("accepts valid payload matching type", () => {
    const schema = { type: "object" };
    expect(validatePayloadSchema(schema, { a: 1 })).toBeNull();
  });

  it("rejects payload with wrong top-level type", () => {
    const schema = { type: "object" };
    const result = validatePayloadSchema(schema, "not-an-object" as unknown as Record<string, unknown>);
    expect(result).toMatch(/expected object/);
  });

  it("rejects missing required field", () => {
    const schema = { type: "object", required: ["prNumber"] };
    const result = validatePayloadSchema(schema, { repoUrl: "x" });
    expect(result).toMatch(/missing required field "prNumber"/);
  });

  it("accepts payload with all required fields present", () => {
    const schema = { type: "object", required: ["prNumber", "repoUrl"] };
    expect(validatePayloadSchema(schema, { prNumber: 42, repoUrl: "x" })).toBeNull();
  });

  it("validates nested property types", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "number" },
      },
    };
    const result = validatePayloadSchema(schema, { count: "not-a-number" });
    expect(result).toMatch(/payload\.count.*expected number/);
  });

  it("accepts correct nested property types", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "number" },
        label: { type: "string" },
      },
    };
    expect(validatePayloadSchema(schema, { count: 5, label: "hello" })).toBeNull();
  });

  it("rejects unexpected field when additionalProperties is false", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    };
    const result = validatePayloadSchema(schema, { name: "x", extra: 1 });
    expect(result).toMatch(/unexpected field "extra"/);
  });

  it("accepts matching payload when additionalProperties is false", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    };
    expect(validatePayloadSchema(schema, { name: "x" })).toBeNull();
  });

  it("validates array item types", () => {
    const schema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
      },
    };
    const result = validatePayloadSchema(schema, { tags: ["a", 42] });
    expect(result).toMatch(/payload\.tags\[1\].*expected string/);
  });

  it("accepts valid array items", () => {
    const schema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
      },
    };
    expect(validatePayloadSchema(schema, { tags: ["a", "b"] })).toBeNull();
  });

  it("allows multiple types via array", () => {
    const schema = { type: ["string", "number"] };
    expect(validatePayloadSchema(schema, "hello" as unknown as Record<string, unknown>)).toBeNull();
    expect(validatePayloadSchema(schema, 42 as unknown as Record<string, unknown>)).toBeNull();
    const result = validatePayloadSchema(schema, [] as unknown as Record<string, unknown>);
    expect(result).toMatch(/expected string \| number/);
  });
});
