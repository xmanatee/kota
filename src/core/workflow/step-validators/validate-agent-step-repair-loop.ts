import type {
  WorkflowRepairLoopConfig,
  WorkflowStepContext,
  WorkflowValueResolver,
} from "#core/workflow/run-types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalFunction,
  expectOptionalInteger,
  expectOptionalObjectOrFunction,
  expectOptionalString,
  isPlainObject,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

type RepairLoopOpaque = unknown;
type RepairLoopRecord = Record<string, RepairLoopOpaque>;

export function validateRepairLoop(
  value: RepairLoopOpaque,
  field: string,
  definitionPath: string,
): WorkflowRepairLoopConfig {
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(`${field} must be an object`, definitionPath);
  }
  const maxRepairAttempts = expectOptionalInteger(
    value.maxRepairAttempts,
    `${field}.maxRepairAttempts`,
    definitionPath,
    1,
  );
  if (!Array.isArray(value.checks) || value.checks.length === 0) {
    throw new WorkflowDefinitionError(
      `${field}.checks must be a non-empty array`,
      definitionPath,
    );
  }
  const checks = value.checks.map((check: RepairLoopOpaque, i: number) => {
    if (!isPlainObject(check)) {
      throw new WorkflowDefinitionError(
        `${field}.checks[${i}] must be an object`,
        definitionPath,
      );
    }
    const severity = expectOptionalString(
      check.severity,
      `${field}.checks[${i}].severity`,
      definitionPath,
    );
    if (severity !== undefined && severity !== "error" && severity !== "warning") {
      throw new WorkflowDefinitionError(
        `${field}.checks[${i}].severity must be "error" or "warning"`,
        definitionPath,
      );
    }

    const phase = expectOptionalInteger(
      check.phase,
      `${field}.checks[${i}].phase`,
      definitionPath,
      0,
    );

    if (check.type === "code") {
      const run = expectOptionalFunction(
        check.run,
        `${field}.checks[${i}].run`,
        definitionPath,
      );
      if (!run) {
        throw new WorkflowDefinitionError(
          `${field}.checks[${i}].run must be a function`,
          definitionPath,
        );
      }
      return {
        id: expectName(check.id, `${field}.checks[${i}].id`, definitionPath),
        type: "code" as const,
        severity: severity as "error" | "warning" | undefined,
        phase,
        run: run as (context: WorkflowStepContext) => Promise<RepairLoopOpaque> | RepairLoopOpaque,
      };
    }

    return {
      id: expectName(check.id, `${field}.checks[${i}].id`, definitionPath),
      type: "tool" as const,
      severity: severity as "error" | "warning" | undefined,
      phase,
      tool: expectNonEmptyString(check.tool, `${field}.checks[${i}].tool`, definitionPath),
      input: expectOptionalObjectOrFunction(
        check.input,
        `${field}.checks[${i}].input`,
        definitionPath,
      ) as WorkflowValueResolver<RepairLoopRecord>,
    };
  });
  return { checks, maxRepairAttempts };
}
