export type StepLanguageCollection = {
  byName?: Record<string, unknown>;
  ordered?: unknown[];
};

export type StepLanguageState = {
  roots?: Record<string, unknown>;
  collections?: Record<string, StepLanguageCollection>;
};

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

export function stringifyValue(value: unknown): string {
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

export { evaluateStepLanguageCondition } from "./step-language-condition.js";

export function renderStepLanguageTemplate(
  template: string,
  state: StepLanguageState,
): string {
  return stringifyValue(resolveStepLanguageValue(template, state));
}
