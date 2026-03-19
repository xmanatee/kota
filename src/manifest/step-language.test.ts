import { describe, expect, it } from "vitest";
import type { StepLanguageState } from "./step-language.js";
import {
	evaluateStepLanguageCondition,
	getFieldByPath,
	renderStepLanguageTemplate,
	resolveStepLanguageRef,
	resolveStepLanguageValue,
	stringifyValue,
} from "./step-language.js";

// ---------------------------------------------------------------------------
// getFieldByPath
// ---------------------------------------------------------------------------

describe("getFieldByPath", () => {
	it("returns a top-level value", () => {
		expect(getFieldByPath({ a: 1 }, "a")).toBe(1);
	});

	it("traverses nested objects", () => {
		expect(getFieldByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
	});

	it("returns undefined for a missing key", () => {
		expect(getFieldByPath({ a: 1 }, "b")).toBeUndefined();
	});

	it("returns undefined when a mid-chain value is null", () => {
		expect(getFieldByPath({ a: null }, "a.b")).toBeUndefined();
	});

	it("returns undefined when a mid-chain value is undefined", () => {
		expect(getFieldByPath({ a: undefined }, "a.b")).toBeUndefined();
	});

	it("returns undefined when a mid-chain value is a primitive", () => {
		expect(getFieldByPath({ a: 5 }, "a.b")).toBeUndefined();
	});

	it("returns undefined for a null root", () => {
		expect(getFieldByPath(null, "a")).toBeUndefined();
	});

	it("accesses array elements via numeric string index", () => {
		expect(getFieldByPath({ items: ["x", "y", "z"] }, "items.1")).toBe("y");
	});
});

// ---------------------------------------------------------------------------
// stringifyValue
// ---------------------------------------------------------------------------

describe("stringifyValue", () => {
	it("returns empty string for null", () => {
		expect(stringifyValue(null)).toBe("");
	});

	it("returns empty string for undefined", () => {
		expect(stringifyValue(undefined)).toBe("");
	});

	it("returns the string as-is", () => {
		expect(stringifyValue("hello")).toBe("hello");
	});

	it("converts a number to string", () => {
		expect(stringifyValue(42)).toBe("42");
	});

	it("converts a boolean to string", () => {
		expect(stringifyValue(true)).toBe("true");
		expect(stringifyValue(false)).toBe("false");
	});

	it("JSON-serialises an object", () => {
		expect(stringifyValue({ x: 1 })).toBe('{"x":1}');
	});

	it("JSON-serialises an array", () => {
		expect(stringifyValue([1, 2])).toBe("[1,2]");
	});
});

// ---------------------------------------------------------------------------
// resolveStepLanguageRef
// ---------------------------------------------------------------------------

const emptyState: StepLanguageState = {};

describe("resolveStepLanguageRef — roots", () => {
	const state: StepLanguageState = {
		roots: { user: { name: "Alice", score: 10 } },
	};

	it("resolves a root by exact name", () => {
		expect(resolveStepLanguageRef("$user", state)).toEqual({
			hit: true,
			value: { name: "Alice", score: 10 },
		});
	});

	it("resolves a root field via dot-path", () => {
		expect(resolveStepLanguageRef("$user.name", state)).toEqual({
			hit: true,
			value: "Alice",
		});
	});

	it("normalises a bare name to $name before resolving", () => {
		expect(resolveStepLanguageRef("user", state)).toEqual({
			hit: true,
			value: { name: "Alice", score: 10 },
		});
	});

	it("normalises a bare name with path", () => {
		expect(resolveStepLanguageRef("user.name", state)).toEqual({
			hit: true,
			value: "Alice",
		});
	});

	it("returns {hit:false} for an unknown ref", () => {
		expect(resolveStepLanguageRef("$unknown", state)).toEqual({ hit: false });
	});

	it("parses a JSON-string root and traverses it", () => {
		const s: StepLanguageState = {
			roots: { data: '{"value":99}' },
		};
		expect(resolveStepLanguageRef("$data.value", s)).toEqual({
			hit: true,
			value: 99,
		});
	});
});

describe("resolveStepLanguageRef — collections index access", () => {
	const state: StepLanguageState = {
		collections: {
			items: {
				ordered: ["first", "second", "third"],
				byName: { alpha: "A", beta: "B" },
			},
		},
	};

	it("resolves ordered item by numeric index", () => {
		expect(resolveStepLanguageRef("$items[0]", state)).toEqual({
			hit: true,
			value: "first",
		});
	});

	it("resolves ordered item by numeric index with field path", () => {
		const s: StepLanguageState = {
			collections: {
				things: { ordered: [{ label: "hi" }] },
			},
		};
		expect(resolveStepLanguageRef("$things[0].label", s)).toEqual({
			hit: true,
			value: "hi",
		});
	});

	it("resolves named item by string key in bracket notation", () => {
		expect(resolveStepLanguageRef("$items[alpha]", state)).toEqual({
			hit: true,
			value: "A",
		});
	});

	it("returns {hit:false} for an unknown collection", () => {
		expect(resolveStepLanguageRef("$missing[0]", state)).toEqual({
			hit: false,
		});
	});
});

describe("resolveStepLanguageRef — collections dot-name access", () => {
	const state: StepLanguageState = {
		collections: {
			items: { byName: { alpha: "A" } },
		},
	};

	it("resolves an item by dot-name notation", () => {
		expect(resolveStepLanguageRef("$items.alpha", state)).toEqual({
			hit: true,
			value: "A",
		});
	});

	it("returns {hit:false} when byName is absent", () => {
		const s: StepLanguageState = {
			collections: { nums: { ordered: [1, 2] } },
		};
		expect(resolveStepLanguageRef("$nums.zero", s)).toEqual({ hit: false });
	});
});

describe("resolveStepLanguageRef — collection root access", () => {
	it("returns byName when collection has both", () => {
		const s: StepLanguageState = {
			collections: { things: { byName: { a: 1 }, ordered: [9] } },
		};
		const r = resolveStepLanguageRef("$things", s);
		expect(r).toEqual({ hit: true, value: { a: 1 } });
	});

	it("returns ordered when only ordered is present", () => {
		const s: StepLanguageState = {
			collections: { nums: { ordered: [1, 2] } },
		};
		const r = resolveStepLanguageRef("$nums", s);
		expect(r).toEqual({ hit: true, value: [1, 2] });
	});
});

// ---------------------------------------------------------------------------
// resolveStepLanguageValue
// ---------------------------------------------------------------------------

describe("resolveStepLanguageValue", () => {
	const state: StepLanguageState = {
		roots: { greeting: "Hello" },
		collections: { tags: { byName: { main: "primary" } } },
	};

	it("resolves a string ref directly", () => {
		expect(resolveStepLanguageValue("$greeting", state)).toBe("Hello");
	});

	it("interpolates a template string", () => {
		expect(resolveStepLanguageValue("{{$greeting}} World", state)).toBe(
			"Hello World",
		);
	});

	it("leaves unresolved template tokens unchanged", () => {
		expect(resolveStepLanguageValue("{{$missing}}", state)).toBe("{{$missing}}");
	});

	it("resolves array entries recursively", () => {
		expect(resolveStepLanguageValue(["$greeting", "literal"], state)).toEqual([
			"Hello",
			"literal",
		]);
	});

	it("resolves object values recursively", () => {
		const result = resolveStepLanguageValue(
			{ label: "$greeting", other: 42 },
			state,
		);
		expect(result).toEqual({ label: "Hello", other: 42 });
	});

	it("passes through non-string primitives unchanged", () => {
		expect(resolveStepLanguageValue(123, state)).toBe(123);
		expect(resolveStepLanguageValue(null, state)).toBeNull();
	});

	it("passes through a string with no ref or template unchanged", () => {
		expect(resolveStepLanguageValue("just text", state)).toBe("just text");
	});
});

// ---------------------------------------------------------------------------
// renderStepLanguageTemplate
// ---------------------------------------------------------------------------

describe("renderStepLanguageTemplate", () => {
	const state: StepLanguageState = { roots: { val: 7 } };

	it("renders a ref to its stringified form", () => {
		expect(renderStepLanguageTemplate("$val", state)).toBe("7");
	});

	it("renders a template string", () => {
		expect(renderStepLanguageTemplate("value is {{$val}}", state)).toBe(
			"value is 7",
		);
	});

	it("renders a plain string unchanged", () => {
		expect(renderStepLanguageTemplate("hello", state)).toBe("hello");
	});
});

// ---------------------------------------------------------------------------
// evaluateStepLanguageCondition
// ---------------------------------------------------------------------------

describe("evaluateStepLanguageCondition — basic equality", () => {
	const state: StepLanguageState = { roots: { x: "foo" } };

	it("empty expression returns true", () => {
		expect(evaluateStepLanguageCondition("", state)).toBe(true);
	});

	it("== true for matching strings", () => {
		expect(evaluateStepLanguageCondition("$x == foo", state)).toBe(true);
	});

	it("== false for non-matching strings", () => {
		expect(evaluateStepLanguageCondition("$x == bar", state)).toBe(false);
	});

	it("!= true for different strings", () => {
		expect(evaluateStepLanguageCondition("$x != bar", state)).toBe(true);
	});

	it("!= false for same string", () => {
		expect(evaluateStepLanguageCondition("$x != foo", state)).toBe(false);
	});
});

describe("evaluateStepLanguageCondition — numeric comparisons", () => {
	const state: StepLanguageState = { roots: { n: 10 } };

	it("> true when left is greater", () => {
		expect(evaluateStepLanguageCondition("$n > 5", state)).toBe(true);
	});

	it("> false when left is equal", () => {
		expect(evaluateStepLanguageCondition("$n > 10", state)).toBe(false);
	});

	it(">= true when equal", () => {
		expect(evaluateStepLanguageCondition("$n >= 10", state)).toBe(true);
	});

	it("< true when left is smaller", () => {
		expect(evaluateStepLanguageCondition("$n < 20", state)).toBe(true);
	});

	it("<= true when equal", () => {
		expect(evaluateStepLanguageCondition("$n <= 10", state)).toBe(true);
	});

	it("falls back to string comparison for non-numeric values", () => {
		expect(evaluateStepLanguageCondition("abc > aaa", emptyState)).toBe(true);
	});
});

describe("evaluateStepLanguageCondition — contains and matches", () => {
	const state: StepLanguageState = { roots: { msg: "hello world" } };

	it("contains returns true when substring present", () => {
		expect(evaluateStepLanguageCondition("$msg contains world", state)).toBe(
			true,
		);
	});

	it("contains returns false when substring absent", () => {
		expect(evaluateStepLanguageCondition("$msg contains bye", state)).toBe(
			false,
		);
	});

	it("matches returns true for valid regex that matches", () => {
		expect(evaluateStepLanguageCondition("$msg matches ^hello", state)).toBe(
			true,
		);
	});

	it("matches returns false for valid regex that does not match", () => {
		expect(evaluateStepLanguageCondition("$msg matches ^bye", state)).toBe(
			false,
		);
	});

	it("matches returns false for invalid regex", () => {
		expect(evaluateStepLanguageCondition("$msg matches [invalid", state)).toBe(
			false,
		);
	});
});

describe("evaluateStepLanguageCondition — boolean operators", () => {
	const state: StepLanguageState = { roots: { a: "1", b: "2" } };

	it("&& returns true when both sides are true", () => {
		expect(
			evaluateStepLanguageCondition("$a == 1 && $b == 2", state),
		).toBe(true);
	});

	it("&& returns false when one side is false", () => {
		expect(
			evaluateStepLanguageCondition("$a == 1 && $b == 9", state),
		).toBe(false);
	});

	it("|| returns true when one side is true", () => {
		expect(
			evaluateStepLanguageCondition("$a == 9 || $b == 2", state),
		).toBe(true);
	});

	it("|| returns false when both sides are false", () => {
		expect(
			evaluateStepLanguageCondition("$a == 9 || $b == 9", state),
		).toBe(false);
	});

	it("! negates a true condition", () => {
		expect(evaluateStepLanguageCondition("!($a == 1)", state)).toBe(false);
	});

	it("! negates a false condition", () => {
		expect(evaluateStepLanguageCondition("!($a == 9)", state)).toBe(true);
	});
});

describe("evaluateStepLanguageCondition — parentheses and precedence", () => {
	const state: StepLanguageState = { roots: { x: "1", y: "2", z: "3" } };

	it("parentheses group correctly", () => {
		expect(
			evaluateStepLanguageCondition(
				"($x == 1 || $y == 9) && $z == 3",
				state,
			),
		).toBe(true);
	});

	it("|| has lower precedence than && without parens", () => {
		// x==9 || (y==2 && z==3) => false || true => true
		expect(
			evaluateStepLanguageCondition("$x == 9 || $y == 2 && $z == 3", state),
		).toBe(true);
	});
});

describe("evaluateStepLanguageCondition — truthiness", () => {
	it("truthy for a non-empty string ref", () => {
		const s: StepLanguageState = { roots: { flag: "yes" } };
		expect(evaluateStepLanguageCondition("$flag", s)).toBe(true);
	});

	it("falsy for empty-string ref", () => {
		const s: StepLanguageState = { roots: { flag: "" } };
		expect(evaluateStepLanguageCondition("$flag", s)).toBe(false);
	});

	it('falsy for string "false"', () => {
		const s: StepLanguageState = { roots: { flag: "false" } };
		expect(evaluateStepLanguageCondition("$flag", s)).toBe(false);
	});

	it('falsy for string "0"', () => {
		const s: StepLanguageState = { roots: { flag: "0" } };
		expect(evaluateStepLanguageCondition("$flag", s)).toBe(false);
	});
});
