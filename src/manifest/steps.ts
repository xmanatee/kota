/**
 * Step resolution and condition evaluation for manifest-based tool pipelines.
 *
 * Thin compatibility wrappers around the shared step language used by workflows.
 * Manifest step pipelines still expose the legacy payload-root API (`$payload`)
 * while sharing the same parser and condition semantics as workflows.
 */

import {
  evaluateStepLanguageCondition,
  getFieldByPath,
  resolveStepLanguageRef,
  resolveStepLanguageValue,
  type StepLanguageState,
} from "./step-language.js";

const WHOLE_STEP_INDEX_RE = /^\$steps\[(\d+)\]$/;

function buildState(
  prevContent: string,
  payload: Record<string, unknown>,
  allOutputs: string[],
): StepLanguageState {
  return {
    roots: {
      prev: prevContent,
      payload,
    },
    collections: {
      steps: {
        ordered: allOutputs,
      },
    },
  };
}

export { getFieldByPath };

export function resolveRef(
  ref: string,
  prevContent: string,
  payload: Record<string, unknown>,
  allOutputs: string[],
): { hit: true; value: unknown } | { hit: false } {
  if (ref.trim() === "$payload") {
    return { hit: true, value: JSON.stringify(payload) };
  }
  const resolved = resolveStepLanguageRef(
    ref,
    buildState(prevContent, payload, allOutputs),
  );
  if (
    resolved.hit &&
    resolved.value === undefined &&
    WHOLE_STEP_INDEX_RE.test(ref.trim())
  ) {
    return { hit: true, value: "" };
  }
  return resolved;
}

function resolveManifestValue(
  value: unknown,
  prevContent: string,
  payload: Record<string, unknown>,
  allOutputs: string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      resolveManifestValue(entry, prevContent, payload, allOutputs),
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveManifestValue(entry, prevContent, payload, allOutputs),
      ]),
    );
  }

  if (value === "$payload") return JSON.stringify(payload);

  if (typeof value === "string") {
    const resolved = resolveRef(value, prevContent, payload, allOutputs);
    if (resolved.hit) return resolved.value;
  }

  return resolveStepLanguageValue(
    value,
    buildState(prevContent, payload, allOutputs),
  );
}

export function resolveStepInput(
  input: Record<string, unknown> | undefined,
  prevContent: string,
  payload: Record<string, unknown>,
  allOutputs: string[] = [],
): Record<string, unknown> {
  if (!input) return {};
  return resolveManifestValue(
    input,
    prevContent,
    payload,
    allOutputs,
  ) as Record<string, unknown>;
}

export function evaluateCondition(
  expr: string,
  prevContent: string,
  payload: Record<string, unknown>,
  allOutputs: string[],
): boolean {
  return evaluateStepLanguageCondition(
    expr,
    buildState(prevContent, payload, allOutputs),
  );
}
