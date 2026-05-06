import type {
  WorkflowAgentStepInput,
  WorkflowEmitStepInput,
  WorkflowRestartStepInput,
  WorkflowToolStepInput,
} from "./step-input-base.js";
import type { WorkflowCodeStepInput } from "./step-input-code.js";
import type {
  WorkflowApprovalStepInput,
  WorkflowAwaitEventStepInput,
  WorkflowBranchStepInput,
  WorkflowForeachStepInput,
  WorkflowParallelGroupInput,
  WorkflowTriggerStepInput,
} from "./step-input-control-flow.js";

export type WorkflowStepInput =
  | WorkflowToolStepInput
  | WorkflowAgentStepInput
  | WorkflowEmitStepInput
  | WorkflowRestartStepInput
  | WorkflowCodeStepInput
  | WorkflowTriggerStepInput
  | WorkflowParallelGroupInput
  | WorkflowBranchStepInput
  | WorkflowForeachStepInput
  | WorkflowApprovalStepInput
  | WorkflowAwaitEventStepInput;
