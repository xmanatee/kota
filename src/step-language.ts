export type StepLanguageCollection = {
  byName?: Record<string, unknown>;
  ordered?: unknown[];
};

export type StepLanguageState = {
  roots?: Record<string, unknown>;
  collections?: Record<string, StepLanguageCollection>;
};

const COMPARISON_RE = /^(.+?)\s*(==|!=|>=|<=|>|<|contains|matches)\s*(.+)$/;
const COLLECTION_INDEX_RE = /^\$([a-zA-Z0-9_-]+)\[(.+?)\](?:\.(.+))?$/;
const COLLECTION_NAME_RE = /^\$([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)(?:\.(.+))?$/;

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

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

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeRef(ref: string, state: StepLanguageState): string {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("$")) return trimmed;

  const names = new Set([
    ...Object.keys(state.roots ?? {}),
    ...Object.keys(state.collections ?? {}),
  ]);
  for (const name of names) {
    if (
      trimmed === name ||
      trimmed.startsWith(`${name}.`) ||
      trimmed.startsWith(`${name}[`)
    ) {
      return `$${trimmed}`;
    }
  }

  return trimmed;
}

function resolveRootRef(
  normalized: string,
  state: StepLanguageState,
): { hit: true; value: unknown } | { hit: false } {
  for (const [name, value] of Object.entries(state.roots ?? {})) {
    if (normalized === `$${name}`) return { hit: true, value };
    if (normalized.startsWith(`$${name}.`)) {
      return {
        hit: true,
        value: getFieldByPath(
          tryParseJson(value),
          normalized.slice(name.length + 2),
        ),
      };
    }
  }
  return { hit: false };
}

function resolveCollectionRef(
  normalized: string,
  state: StepLanguageState,
): { hit: true; value: unknown } | { hit: false } {
  const byIndex = COLLECTION_INDEX_RE.exec(normalized);
  if (byIndex) {
    const collection = state.collections?.[byIndex[1]];
    if (!collection) return { hit: false };

    const rawKey = byIndex[2].trim();
    const numeric = /^\d+$/.test(rawKey);
    const raw = numeric
      ? collection.ordered?.[Number.parseInt(rawKey, 10)]
      : collection.byName?.[rawKey];
    if (!byIndex[3]) return { hit: true, value: raw };
    return {
      hit: true,
      value: getFieldByPath(tryParseJson(raw), byIndex[3]),
    };
  }

  const byName = COLLECTION_NAME_RE.exec(normalized);
  if (byName) {
    const collection = state.collections?.[byName[1]];
    if (!collection?.byName) return { hit: false };
    const raw = collection.byName[byName[2]];
    if (!byName[3]) return { hit: true, value: raw };
    return {
      hit: true,
      value: getFieldByPath(tryParseJson(raw), byName[3]),
    };
  }

  for (const [name, collection] of Object.entries(state.collections ?? {})) {
    if (normalized === `$${name}`) {
      return {
        hit: true,
        value: collection.byName ?? collection.ordered ?? {},
      };
    }
  }

  return { hit: false };
}

export function resolveStepLanguageRef(
  ref: string,
  state: StepLanguageState,
): { hit: true; value: unknown } | { hit: false } {
  const normalized = normalizeRef(ref, state);
  const root = resolveRootRef(normalized, state);
  if (root.hit) return root;
  return resolveCollectionRef(normalized, state);
}

export function resolveStepLanguageValue(
  value: unknown,
  state: StepLanguageState,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveStepLanguageValue(entry, state));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveStepLanguageValue(entry, state),
      ]),
    );
  }

  if (typeof value !== "string") return value;

  const wholeRef = resolveStepLanguageRef(value, state);
  if (wholeRef.hit) return wholeRef.value;

  if (value.includes("{{") && value.includes("}}")) {
    return value.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
      const resolved = resolveStepLanguageRef(expr.trim(), state);
      if (!resolved.hit) return `{{${expr}}}`;
      return stringifyValue(resolved.value);
    });
  }

  return value;
}

function resolveConditionValue(expr: string, state: StepLanguageState): unknown {
  const ref = resolveStepLanguageRef(expr, state);
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
  const leftString = stringifyValue(left);
  const rightString = stringifyValue(right);
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const numeric =
    left !== "" &&
    right !== "" &&
    !Number.isNaN(leftNumber) &&
    !Number.isNaN(rightNumber);

  switch (op) {
    case "==":
      return leftString === rightString;
    case "!=":
      return leftString !== rightString;
    case ">":
      return numeric ? leftNumber > rightNumber : leftString > rightString;
    case "<":
      return numeric ? leftNumber < rightNumber : leftString < rightString;
    case ">=":
      return numeric ? leftNumber >= rightNumber : leftString >= rightString;
    case "<=":
      return numeric ? leftNumber <= rightNumber : leftString <= rightString;
    case "contains":
      return leftString.includes(rightString);
    case "matches":
      try {
        return new RegExp(rightString).test(leftString);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function splitAtDepth0(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= expr.length - op.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;
    else if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(expr.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

function matchingParenIndex(expr: string): number {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function evaluateAtom(expr: string, state: StepLanguageState): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;

  if (trimmed.startsWith("!")) {
    return !evaluateAtom(trimmed.slice(1), state);
  }

  if (trimmed.startsWith("(")) {
    const close = matchingParenIndex(trimmed);
    if (close === trimmed.length - 1) {
      return evaluateStepLanguageCondition(trimmed.slice(1, -1), state);
    }
  }

  const comparison = COMPARISON_RE.exec(trimmed);
  if (comparison) {
    const left = resolveConditionValue(comparison[1].trim(), state);
    const right = resolveConditionValue(comparison[3].trim(), state);
    return compareValues(left, right, comparison[2]);
  }

  return isTruthy(resolveConditionValue(trimmed, state));
}

export function evaluateStepLanguageCondition(
  expr: string,
  state: StepLanguageState,
): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;

  const orClauses = splitAtDepth0(trimmed, "||");
  if (orClauses.length > 1) {
    return orClauses.some((clause) =>
      evaluateStepLanguageCondition(clause.trim(), state),
    );
  }

  const andClauses = splitAtDepth0(trimmed, "&&");
  if (andClauses.length > 1) {
    return andClauses.every((clause) =>
      evaluateStepLanguageCondition(clause.trim(), state),
    );
  }

  return evaluateAtom(trimmed, state);
}

export function renderStepLanguageTemplate(
  template: string,
  state: StepLanguageState,
): string {
  return stringifyValue(resolveStepLanguageValue(template, state));
}
