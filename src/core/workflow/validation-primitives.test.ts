import { describe, expect, it } from "vitest";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  expectOptionalObjectOrFunction,
  expectOptionalPositiveNumber,
  expectOptionalScalarFilter,
  expectOptionalString,
  expectOptionalStringArray,
  expectRelativePath,
  isPlainObject,
  WorkflowDefinitionError,
} from "./validation-primitives.js";

const path = "/def.ts";

describe("WorkflowDefinitionError", () => {
  it("includes definitionPath in message", () => {
    const err = new WorkflowDefinitionError("bad field", "/foo.ts");
    expect(err.message).toContain("/foo.ts");
    expect(err.message).toContain("bad field");
    expect(err.name).toBe("WorkflowDefinitionError");
    expect(err.definitionPath).toBe("/foo.ts");
  });
});

describe("isPlainObject", () => {
  it("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("returns false for non-objects", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(() => {})).toBe(false);
  });
});

describe("expectRelativePath", () => {
  it("returns trimmed relative path", () => {
    expect(expectRelativePath("src/foo.ts", "f", path)).toBe("src/foo.ts");
    expect(expectRelativePath("  src/foo.ts  ", "f", path)).toBe("src/foo.ts");
  });

  it("throws for non-string or empty", () => {
    expect(() => expectRelativePath(undefined, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectRelativePath("   ", "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectRelativePath(42, "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws for absolute path", () => {
    expect(() => expectRelativePath("/abs/path", "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("error includes definitionPath", () => {
    expect(() => expectRelativePath(null, "f", path)).toThrow(path);
  });
});

describe("expectName", () => {
  it("returns valid names", () => {
    expect(expectName("builder", "n", path)).toBe("builder");
    expect(expectName("my-workflow-1", "n", path)).toBe("my-workflow-1");
    expect(expectName("  foo  ", "n", path)).toBe("foo");
  });

  it("throws for non-string or empty", () => {
    expect(() => expectName(undefined, "n", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectName("", "n", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectName(42, "n", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws for names not matching pattern", () => {
    expect(() => expectName("Foo", "n", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectName("-foo", "n", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectName("foo_bar", "n", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectName("foo bar", "n", path)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectNonEmptyString", () => {
  it("returns trimmed string", () => {
    expect(expectNonEmptyString("hello", "f", path)).toBe("hello");
    expect(expectNonEmptyString("  hi  ", "f", path)).toBe("hi");
  });

  it("throws for non-string or empty/whitespace", () => {
    expect(() => expectNonEmptyString(undefined, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectNonEmptyString("   ", "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectNonEmptyString(0, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectNonEmptyString(null, "f", path)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectOptionalString", () => {
  it("returns undefined for undefined input", () => {
    expect(expectOptionalString(undefined, "f", path)).toBeUndefined();
  });

  it("returns trimmed string for valid input", () => {
    expect(expectOptionalString("hello", "f", path)).toBe("hello");
    expect(expectOptionalString("  hi  ", "f", path)).toBe("hi");
  });

  it("throws for empty or whitespace string", () => {
    expect(() => expectOptionalString("", "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalString("  ", "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws for non-string non-undefined", () => {
    expect(() => expectOptionalString(42, "f", path)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectOptionalBoolean", () => {
  it("returns undefined for undefined input", () => {
    expect(expectOptionalBoolean(undefined, "f", path)).toBeUndefined();
  });

  it("returns boolean values", () => {
    expect(expectOptionalBoolean(true, "f", path)).toBe(true);
    expect(expectOptionalBoolean(false, "f", path)).toBe(false);
  });

  it("throws for non-boolean", () => {
    expect(() => expectOptionalBoolean("true", "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalBoolean(1, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalBoolean(null, "f", path)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectOptionalInteger", () => {
  it("returns undefined for undefined input", () => {
    expect(expectOptionalInteger(undefined, "f", path)).toBeUndefined();
  });

  it("accepts integers at or above minimum", () => {
    expect(expectOptionalInteger(0, "f", path)).toBe(0);
    expect(expectOptionalInteger(5, "f", path)).toBe(5);
    expect(expectOptionalInteger(1, "f", path, 1)).toBe(1);
  });

  it("throws for non-integer", () => {
    expect(() => expectOptionalInteger(1.5, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalInteger("1", "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws when below minimum", () => {
    expect(() => expectOptionalInteger(-1, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalInteger(0, "f", path, 1)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectOptionalPositiveNumber", () => {
  it("returns undefined for undefined input", () => {
    expect(expectOptionalPositiveNumber(undefined, "f", path)).toBeUndefined();
  });

  it("accepts positive numbers", () => {
    expect(expectOptionalPositiveNumber(1, "f", path)).toBe(1);
    expect(expectOptionalPositiveNumber(0.5, "f", path)).toBe(0.5);
    expect(expectOptionalPositiveNumber(1000, "f", path)).toBe(1000);
  });

  it("throws for zero or negative", () => {
    expect(() => expectOptionalPositiveNumber(0, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalPositiveNumber(-1, "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws for non-finite or non-number", () => {
    expect(() => expectOptionalPositiveNumber(Infinity, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalPositiveNumber(NaN, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalPositiveNumber("1", "f", path)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectOptionalStringArray", () => {
  it("returns undefined for undefined input", () => {
    expect(expectOptionalStringArray(undefined, "f", path)).toBeUndefined();
  });

  it("returns trimmed string array", () => {
    expect(expectOptionalStringArray(["a", "b"], "f", path)).toEqual(["a", "b"]);
    expect(expectOptionalStringArray(["  a  ", " b "], "f", path)).toEqual(["a", "b"]);
  });

  it("returns empty array", () => {
    expect(expectOptionalStringArray([], "f", path)).toEqual([]);
  });

  it("throws for non-array", () => {
    expect(() => expectOptionalStringArray("a", "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalStringArray({}, "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws for array containing empty strings", () => {
    expect(() => expectOptionalStringArray(["a", ""], "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalStringArray(["a", "  "], "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws for array containing non-strings", () => {
    expect(() => expectOptionalStringArray(["a", 1], "f", path)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectOptionalScalarFilter", () => {
  it("returns undefined for undefined input", () => {
    expect(expectOptionalScalarFilter(undefined, "f", path)).toBeUndefined();
  });

  it("accepts scalar values", () => {
    expect(expectOptionalScalarFilter({ key: "val" }, "f", path)).toEqual({ key: "val" });
    expect(expectOptionalScalarFilter({ key: 1 }, "f", path)).toEqual({ key: 1 });
    expect(expectOptionalScalarFilter({ key: true }, "f", path)).toEqual({ key: true });
  });

  it("accepts array of scalars", () => {
    expect(expectOptionalScalarFilter({ key: ["a", "b"] }, "f", path)).toEqual({ key: ["a", "b"] });
  });

  it("throws for non-object", () => {
    expect(() => expectOptionalScalarFilter("str", "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalScalarFilter([], "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws for empty array value", () => {
    expect(() => expectOptionalScalarFilter({ key: [] }, "f", path)).toThrow(WorkflowDefinitionError);
  });

  it("throws for non-scalar array values", () => {
    expect(() => expectOptionalScalarFilter({ key: [{}] }, "f", path)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectOptionalObjectOrFunction", () => {
  it("returns undefined for undefined input", () => {
    expect(expectOptionalObjectOrFunction(undefined, "f", path)).toBeUndefined();
  });

  it("returns plain objects", () => {
    const obj = { a: 1 };
    expect(expectOptionalObjectOrFunction(obj, "f", path)).toBe(obj);
  });

  it("returns functions", () => {
    const fn = () => {};
    expect(expectOptionalObjectOrFunction(fn, "f", path)).toBe(fn);
  });

  it("throws for non-object non-function", () => {
    expect(() => expectOptionalObjectOrFunction("str", "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalObjectOrFunction(42, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalObjectOrFunction([], "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalObjectOrFunction(null, "f", path)).toThrow(WorkflowDefinitionError);
  });
});

describe("expectOptionalFunction", () => {
  it("returns undefined for undefined input", () => {
    expect(expectOptionalFunction(undefined, "f", path)).toBeUndefined();
  });

  it("returns functions", () => {
    const fn = () => {};
    expect(expectOptionalFunction(fn, "f", path)).toBe(fn);
  });

  it("throws for non-function", () => {
    expect(() => expectOptionalFunction({}, "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalFunction("fn", "f", path)).toThrow(WorkflowDefinitionError);
    expect(() => expectOptionalFunction(null, "f", path)).toThrow(WorkflowDefinitionError);
  });
});
