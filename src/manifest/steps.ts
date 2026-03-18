/**
 * Step resolution and condition evaluation for manifest-based tool pipelines.
 *
 * Pure functions — no side effects, no external dependencies beyond types.
 * Used by both module event handlers and the `pipe` tool.
 */

const COMPARISON_RE = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
const STEPS_REF_RE = /^\$steps\[(\d+)\](?:\.(.+))?$/;

/** Attempt to parse a string as JSON. Returns the string itself on failure. */
function tryParseJson(str: string): unknown {
	try {
		return JSON.parse(str);
	} catch {
		return str;
	}
}

/** Traverse an object by dot-separated path. Returns undefined if missing. */
export function getFieldByPath(obj: unknown, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

/**
 * Resolve a single reference string to its value.
 * Returns `{ hit: true, value }` for recognized references, `{ hit: false }` otherwise.
 */
export function resolveRef(
	ref: string,
	prevContent: string,
	payload: Record<string, unknown>,
	allOutputs: string[],
): { hit: true; value: unknown } | { hit: false } {
	// $prev or $prev.field.path
	if (ref === "$prev") return { hit: true, value: prevContent };
	if (ref.startsWith("$prev.")) {
		const path = ref.slice(6);
		return { hit: true, value: getFieldByPath(tryParseJson(prevContent), path) };
	}

	// $steps[N] or $steps[N].field.path
	const m = STEPS_REF_RE.exec(ref);
	if (m) {
		const idx = Number.parseInt(m[1], 10);
		const raw = idx < allOutputs.length ? allOutputs[idx] : "";
		if (!m[2]) return { hit: true, value: raw };
		return { hit: true, value: getFieldByPath(tryParseJson(raw), m[2]) };
	}

	// $payload or $payload.field.path
	if (ref === "$payload") return { hit: true, value: JSON.stringify(payload) };
	if (ref.startsWith("$payload.")) {
		const path = ref.slice(9);
		return { hit: true, value: getFieldByPath(payload, path) };
	}

	return { hit: false };
}

/**
 * Resolve step input by replacing reference strings and template expressions.
 *
 * Whole-value substitution: "$prev", "$payload", "$steps[N]", "$prev.field",
 * "$steps[N].field", "$payload.field".
 *
 * Inline templates: "prefix {{$prev.name}} suffix" — each {{ref}} is resolved
 * and stringified inline.
 *
 * Non-string values pass through unchanged.
 */
export function resolveStepInput(
	input: Record<string, unknown> | undefined,
	prevContent: string,
	payload: Record<string, unknown>,
	allOutputs: string[] = [],
): Record<string, unknown> {
	if (!input) return {};
	const resolved: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (typeof value !== "string") {
			resolved[key] = value;
			continue;
		}

		// Whole-value reference
		const ref = resolveRef(value, prevContent, payload, allOutputs);
		if (ref.hit) {
			resolved[key] = ref.value;
			continue;
		}

		// Inline template interpolation
		if (value.includes("{{") && value.includes("}}")) {
			resolved[key] = value.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
				const r = resolveRef(expr.trim(), prevContent, payload, allOutputs);
				if (!r.hit) return `{{${expr}}}`;
				return r.value === undefined ? "" : String(r.value);
			});
			continue;
		}

		resolved[key] = value;
	}
	return resolved;
}

function resolveValue(
	expr: string,
	prevContent: string,
	payload: Record<string, unknown>,
	allOutputs: string[],
): unknown {
	const ref = resolveRef(expr, prevContent, payload, allOutputs);
	if (ref.hit) return ref.value;
	return expr;
}

function isTruthy(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (value === "" || value === "false" || value === "0") return false;
	if (value === false || value === 0) return false;
	return true;
}

function compareValues(left: unknown, right: unknown, op: string): boolean {
	const lStr = String(left);
	const rStr = String(right);
	const lNum = Number(left);
	const rNum = Number(right);
	const numeric = left !== "" && right !== "" && !Number.isNaN(lNum) && !Number.isNaN(rNum);

	switch (op) {
		case "==": return lStr === rStr;
		case "!=": return lStr !== rStr;
		case ">": return numeric ? lNum > rNum : lStr > rStr;
		case "<": return numeric ? lNum < rNum : lStr < rStr;
		case ">=": return numeric ? lNum >= rNum : lStr >= rStr;
		case "<=": return numeric ? lNum <= rNum : lStr <= rStr;
		default: return false;
	}
}

/**
 * Evaluate a guard condition expression.
 * Returns true if the step should execute, false if it should be skipped.
 */
export function evaluateCondition(
	expr: string,
	prevContent: string,
	payload: Record<string, unknown>,
	allOutputs: string[],
): boolean {
	const trimmed = expr.trim();
	if (!trimmed) return true;

	const m = COMPARISON_RE.exec(trimmed);
	if (m) {
		const left = resolveValue(m[1].trim(), prevContent, payload, allOutputs);
		const right = resolveValue(m[3].trim(), prevContent, payload, allOutputs);
		return compareValues(left, right, m[2]);
	}

	return isTruthy(resolveValue(trimmed, prevContent, payload, allOutputs));
}
