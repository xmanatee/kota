import {
  resolveStepLanguageRef,
  type StepLanguageState,
  stringifyValue,
} from "./step-language.js";

const COMPARISON_RE = /^(.+?)\s*(==|!=|>=|<=|>|<|contains|matches)\s*(.+)$/;

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
