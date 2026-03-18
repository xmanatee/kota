import { describe, expect, it } from "vitest";
import { evaluateCondition, getFieldByPath, resolveRef, resolveStepInput } from "./steps.js";

describe("getFieldByPath edge cases", () => {
	it("returns undefined for primitive input", () => {
		expect(getFieldByPath(42, "foo")).toBeUndefined();
		expect(getFieldByPath(true, "foo")).toBeUndefined();
	});

	it("returns undefined when traversing through null mid-chain", () => {
		expect(getFieldByPath({ a: { b: null } }, "a.b.c")).toBeUndefined();
	});

	it("returns undefined when traversing through undefined mid-chain", () => {
		expect(getFieldByPath({ a: {} }, "a.b.c")).toBeUndefined();
	});

	it("returns array elements by numeric string key", () => {
		expect(getFieldByPath({ items: [10, 20, 30] }, "items.1")).toBe(20);
	});

	it("handles empty string path segment", () => {
		const result = getFieldByPath({ "": { nested: "val" } }, ".nested");
		expect(result).toBe("val");
	});
});

describe("resolveRef edge cases", () => {
	it("returns empty string for out-of-bounds $steps with field path", () => {
		const r = resolveRef("$steps[99].name", "", {}, ["only-one"]);
		expect(r).toEqual({ hit: true, value: undefined });
	});

	it("resolves $steps[0] correctly", () => {
		const r = resolveRef("$steps[0]", "", {}, ["zero"]);
		expect(r).toEqual({ hit: true, value: "zero" });
	});

	it("resolves $payload with empty payload", () => {
		const r = resolveRef("$payload", "", {}, []);
		expect(r).toEqual({ hit: true, value: "{}" });
	});

	it("resolves $payload.missing returns undefined", () => {
		const r = resolveRef("$payload.missing", "", { other: 1 }, []);
		expect(r).toEqual({ hit: true, value: undefined });
	});

	it("resolves $prev.field with non-JSON prev returns undefined", () => {
		const r = resolveRef("$prev.name", "not-json", {}, []);
		expect(r).toEqual({ hit: true, value: undefined });
	});

	it("$steps[N].field parses JSON content", () => {
		const r = resolveRef("$steps[0].key", "", {}, ['{"key":"value"}']);
		expect(r).toEqual({ hit: true, value: "value" });
	});

	it("does not match partial ref strings", () => {
		expect(resolveRef("$preview", "", {}, []).hit).toBe(false);
		expect(resolveRef("$payloads", "", {}, []).hit).toBe(false);
		expect(resolveRef("$step[0]", "", {}, []).hit).toBe(false);
	});
});

describe("resolveStepInput edge cases", () => {
	it("handles nested object values without resolving", () => {
		const result = resolveStepInput(
			{ config: { nested: true, deep: { val: 1 } } },
			"prev",
			{},
		);
		expect(result.config).toEqual({ nested: true, deep: { val: 1 } });
	});

	it("handles mixed ref and non-ref values", () => {
		const result = resolveStepInput(
			{ a: "$prev", b: 42, c: "plain", d: true },
			"resolved",
			{},
		);
		expect(result.a).toBe("resolved");
		expect(result.b).toBe(42);
		expect(result.c).toBe("plain");
		expect(result.d).toBe(true);
	});

	it("template with multiple refs in same string", () => {
		const result = resolveStepInput(
			{ msg: "{{$prev.a}}-{{$prev.b}}-{{$payload.c}}" },
			'{"a":"x","b":"y"}',
			{ c: "z" },
		);
		expect(result.msg).toBe("x-y-z");
	});

	it("template with undefined ref produces empty string", () => {
		const result = resolveStepInput(
			{ msg: "prefix-{{$prev.nope}}-suffix" },
			'{"other":"val"}',
			{},
		);
		expect(result.msg).toBe("prefix--suffix");
	});

	it("string with {{ but no }} passes through unchanged", () => {
		const result = resolveStepInput(
			{ text: "has {{ but no closing" },
			"prev",
			{},
		);
		expect(result.text).toBe("has {{ but no closing");
	});

	it("string with }} but no {{ passes through unchanged", () => {
		const result = resolveStepInput(
			{ text: "has }} but no opening" },
			"prev",
			{},
		);
		expect(result.text).toBe("has }} but no opening");
	});
});

describe("evaluateCondition edge cases", () => {
	it("handles non-ref literal on left side of comparison", () => {
		expect(evaluateCondition("hello == hello", "", {}, [])).toBe(true);
		expect(evaluateCondition("hello == world", "", {}, [])).toBe(false);
	});

	it("string comparison with > operator uses lexicographic order", () => {
		expect(evaluateCondition("b > a", "", {}, [])).toBe(true);
		expect(evaluateCondition("a > b", "", {}, [])).toBe(false);
	});

	it("expression with empty right side treated as bare truthiness check", () => {
		// "$prev == " doesn't match comparison regex (right side requires 1+ chars)
		// Falls through to bare truthiness — the literal string "$prev == " is truthy
		expect(evaluateCondition("$prev == ", "5", {}, [])).toBe(true);
	});

	it("$steps[N] ref in condition", () => {
		expect(evaluateCondition("$steps[0]", "", {}, ["truthy"])).toBe(true);
		expect(evaluateCondition("$steps[0]", "", {}, [""])).toBe(false);
		expect(evaluateCondition("$steps[0]", "", {}, ["0"])).toBe(false);
	});

	it("$payload ref in condition", () => {
		expect(evaluateCondition("$payload.active", "", { active: "yes" }, [])).toBe(true);
		expect(evaluateCondition("$payload.active", "", { active: "" }, [])).toBe(false);
	});

	it("numeric equality via == compares as strings", () => {
		expect(evaluateCondition("$prev == 5", "5", {}, [])).toBe(true);
		expect(evaluateCondition("$prev == 5.0", "5", {}, [])).toBe(false);
	});

	it("<= with equal numeric values", () => {
		expect(evaluateCondition("$prev.n <= 10", '{"n":10}', {}, [])).toBe(true);
	});

	it(">= with equal numeric values", () => {
		expect(evaluateCondition("$prev.n >= 10", '{"n":10}', {}, [])).toBe(true);
	});

	it("non-ref bare value — truthy literal", () => {
		expect(evaluateCondition("anything", "", {}, [])).toBe(true);
	});

	it("falsy bare values: 'false' and '0'", () => {
		expect(evaluateCondition("false", "", {}, [])).toBe(false);
		expect(evaluateCondition("0", "", {}, [])).toBe(false);
	});
});

describe("evaluateCondition — contains operator", () => {
	it("returns true when $prev contains substring", () => {
		expect(evaluateCondition("$prev contains error", "an error occurred", {}, [])).toBe(true);
	});

	it("returns false when $prev does not contain substring", () => {
		expect(evaluateCondition("$prev contains error", "all good", {}, [])).toBe(false);
	});

	it("works with $steps[N] reference", () => {
		expect(evaluateCondition("$steps[0] contains ok", "", {}, ["status: ok"])).toBe(true);
		expect(evaluateCondition("$steps[0] contains fail", "", {}, ["status: ok"])).toBe(false);
	});

	it("works with $payload field", () => {
		expect(evaluateCondition("$payload.msg contains hello", "", { msg: "say hello world" }, [])).toBe(true);
	});

	it("is case-sensitive", () => {
		expect(evaluateCondition("$prev contains Error", "an error occurred", {}, [])).toBe(false);
		expect(evaluateCondition("$prev contains Error", "an Error occurred", {}, [])).toBe(true);
	});
});

describe("evaluateCondition — matches operator", () => {
	it("matches simple regex", () => {
		expect(evaluateCondition("$prev matches ^200$", "200", {}, [])).toBe(true);
		expect(evaluateCondition("$prev matches ^200$", "2001", {}, [])).toBe(false);
	});

	it("matches digit patterns", () => {
		expect(evaluateCondition("$prev matches ^2\\d\\d$", "204", {}, [])).toBe(true);
		expect(evaluateCondition("$prev matches ^2\\d\\d$", "404", {}, [])).toBe(false);
	});

	it("returns false on invalid regex", () => {
		expect(evaluateCondition("$prev matches [invalid", "anything", {}, [])).toBe(false);
	});

	it("matches partial content", () => {
		expect(evaluateCondition("$prev matches error", "an error occurred", {}, [])).toBe(true);
	});
});

describe("evaluateCondition — && operator", () => {
	it("true when both sides are truthy", () => {
		expect(evaluateCondition("$prev && $payload.ok", "yes", { ok: "true" }, [])).toBe(true);
	});

	it("false when left side is falsy", () => {
		expect(evaluateCondition("$prev && $payload.ok", "", { ok: "true" }, [])).toBe(false);
	});

	it("false when right side is falsy", () => {
		expect(evaluateCondition("$prev && $payload.ok", "yes", { ok: "" }, [])).toBe(false);
	});

	it("chains three conditions", () => {
		expect(evaluateCondition(
			"$prev && $steps[0] && $payload.x",
			"a", { x: "b" }, ["c"],
		)).toBe(true);
		expect(evaluateCondition(
			"$prev && $steps[0] && $payload.x",
			"a", { x: "" }, ["c"],
		)).toBe(false);
	});

	it("works with comparisons", () => {
		expect(evaluateCondition(
			"$prev.status == 200 && $prev.ok == true",
			'{"status":"200","ok":"true"}', {}, [],
		)).toBe(true);
		expect(evaluateCondition(
			"$prev.status == 200 && $prev.ok == true",
			'{"status":"200","ok":"false"}', {}, [],
		)).toBe(false);
	});
});

describe("evaluateCondition — || operator", () => {
	it("true when either side is truthy", () => {
		expect(evaluateCondition("$prev || $payload.fallback", "", { fallback: "yes" }, [])).toBe(true);
		expect(evaluateCondition("$prev || $payload.fallback", "yes", { fallback: "" }, [])).toBe(true);
	});

	it("false when both sides are falsy", () => {
		expect(evaluateCondition("$prev || $payload.fallback", "", { fallback: "" }, [])).toBe(false);
	});

	it("chains three conditions", () => {
		expect(evaluateCondition("$prev || $steps[0] || $payload.x", "", { x: "" }, [""])).toBe(false);
		expect(evaluateCondition("$prev || $steps[0] || $payload.x", "", { x: "yes" }, [""])).toBe(true);
	});
});

describe("evaluateCondition — ! negation", () => {
	it("negates truthy value", () => {
		expect(evaluateCondition("!$prev", "truthy", {}, [])).toBe(false);
	});

	it("negates falsy value", () => {
		expect(evaluateCondition("!$prev", "", {}, [])).toBe(true);
	});

	it("negates comparison", () => {
		expect(evaluateCondition("!($prev == error)", "error", {}, [])).toBe(false);
		expect(evaluateCondition("!($prev == error)", "ok", {}, [])).toBe(true);
	});

	it("double negation", () => {
		expect(evaluateCondition("!!$prev", "truthy", {}, [])).toBe(true);
		expect(evaluateCondition("!!$prev", "", {}, [])).toBe(false);
	});
});

describe("evaluateCondition — parentheses", () => {
	it("groups || inside &&", () => {
		// ($prev || $steps[0]) && $payload.ok
		// prev is falsy, steps[0] is truthy, payload.ok is truthy → true
		expect(evaluateCondition(
			"($prev || $steps[0]) && $payload.ok",
			"", { ok: "yes" }, ["truthy"],
		)).toBe(true);
	});

	it("respects grouping precedence", () => {
		// Without parens: A || B && C = A || (B && C)
		// A=true, B=false, C=false → true (A is truthy)
		expect(evaluateCondition("$prev || $steps[0] && $payload.x", "yes", { x: "" }, [""])).toBe(true);
		// With parens: (A || B) && C
		// A=true, B=false, C=false → false (C is falsy)
		expect(evaluateCondition("($prev || $steps[0]) && $payload.x", "yes", { x: "" }, [""])).toBe(false);
	});

	it("nested parentheses", () => {
		expect(evaluateCondition("(($prev))", "truthy", {}, [])).toBe(true);
		expect(evaluateCondition("(($prev))", "", {}, [])).toBe(false);
	});
});

describe("evaluateCondition — combined operators", () => {
	it("contains with && and ||", () => {
		expect(evaluateCondition(
			"$prev contains healthy && $steps[0] contains 200",
			"status: healthy", {}, ["HTTP 200 OK"],
		)).toBe(true);
		expect(evaluateCondition(
			"$prev contains error || $prev contains warning",
			"a warning was raised", {}, [],
		)).toBe(true);
	});

	it("negation with contains", () => {
		expect(evaluateCondition("!($prev contains error)", "all good", {}, [])).toBe(true);
		expect(evaluateCondition("!($prev contains error)", "an error", {}, [])).toBe(false);
	});

	it("matches with &&", () => {
		expect(evaluateCondition(
			"$prev matches ^2\\d\\d$ && $steps[0] contains ok",
			"200", {}, ["result: ok"],
		)).toBe(true);
	});

	it("real-world: API health check workflow", () => {
		const healthy = '{"status":200,"body":"healthy"}';
		const degraded = '{"status":200,"body":"degraded"}';
		const down = '{"status":500,"body":"error"}';

		const isHealthy = "$prev.status == 200 && $prev.body contains healthy";
		const isDegraded = "$prev.status == 200 && !($prev.body contains healthy)";
		const isDown = "$prev.status != 200";

		expect(evaluateCondition(isHealthy, healthy, {}, [])).toBe(true);
		expect(evaluateCondition(isHealthy, degraded, {}, [])).toBe(false);
		expect(evaluateCondition(isHealthy, down, {}, [])).toBe(false);

		expect(evaluateCondition(isDegraded, healthy, {}, [])).toBe(false);
		expect(evaluateCondition(isDegraded, degraded, {}, [])).toBe(true);
		expect(evaluateCondition(isDegraded, down, {}, [])).toBe(false);

		expect(evaluateCondition(isDown, healthy, {}, [])).toBe(false);
		expect(evaluateCondition(isDown, degraded, {}, [])).toBe(false);
		expect(evaluateCondition(isDown, down, {}, [])).toBe(true);
	});
});
