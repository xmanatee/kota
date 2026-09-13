import { describe, expect, it } from "vitest";
import { compileJsonSchema2020, validateJsonSchema2020 } from "./json-schema-2020.js";

describe("offline JSON Schema 2020-12 validation", () => {
  it("enforces local references, composition and unevaluated properties", () => {
    const schema = {type: "object", $defs: {positive: {type: "integer", minimum: 1}}, allOf: [{properties: {count: {$ref: "#/$defs/positive"}}, required: ["count"]}], unevaluatedProperties: false};
    expect(validateJsonSchema2020(schema, {count: 2}, "input")).toBeNull();
    expect(validateJsonSchema2020(schema, {count: 0}, "input")).toContain("input/count");
    expect(validateJsonSchema2020(schema, {count: 2, extra: true}, "input")).toContain("unevaluated properties");
    expect(validateJsonSchema2020({type: "array", prefixItems: [{const: 0}], items: false}, [0], "output")).toBeNull();
    expect(validateJsonSchema2020({type: "array", prefixItems: [{const: 0}], items: false}, [0, 1], "output")).not.toBeNull();
  });

  it("interrupts reference-expanded validation and permits subsequent useful validation", () => {
    const definitions: Record<string, {type: string} | {anyOf: {$ref: string}[]}> = {level0: {type: "string"}};
    for (let level = 1; level <= 28; level++) {
      definitions[`level${level}`] = {anyOf: [{$ref: `#/$defs/level${level - 1}`}, {$ref: `#/$defs/level${level - 1}`}]};
    }
    const validate = compileJsonSchema2020({type: "object", $defs: definitions, properties: {value: {$ref: "#/$defs/level28"}}});
    expect(validate({value: 42}, "output")).toContain("execution time limit");
    expect(validate({}, "output")).toBeNull();
  });

  it("interrupts pathological patterns without rejecting later ordinary values", () => {
    const validate = compileJsonSchema2020({type: "string", pattern: "^(a+)+$"});
    expect(validate(`${"a".repeat(100)}!`, "input")).toContain("execution time limit");
    expect(validate("aaa", "input")).toBeNull();
  });

  it("rejects malformed schemas, unsupported dialects, and unresolved external references", () => {
    expect(() => compileJsonSchema2020({type: "invalid"})).toThrow("schema is invalid");
    expect(() => compileJsonSchema2020({$schema: "https://example.test/schema"})).toThrow("Unsupported JSON Schema dialect");
    expect(() => compileJsonSchema2020({$ref: "https://example.test/private-schema"})).toThrow("can't resolve reference");
    expect(() => compileJsonSchema2020({$async: true})).toThrow("Asynchronous");
  });
});
