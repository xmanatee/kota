import { z } from "zod";
import type { CodeStepOutputValidator } from "#core/workflow/step-input-code.js";

export type WorkflowCommitOutcome =
  | {
      committed: false;
      committedPaths: [];
      daemonRestartRequired: false;
    }
  | {
      committed: true;
      committedPaths: string[];
      daemonRestartRequired: boolean;
    };

export type CommitResult =
  | Extract<WorkflowCommitOutcome, { committed: false }>
  | (Extract<WorkflowCommitOutcome, { committed: true }> & {
      message: string;
      sha: string;
    });

const workflowCommitOutcomeSchema = z.discriminatedUnion("committed", [
  z.object({
    committed: z.literal(false),
    committedPaths: z.tuple([]),
    daemonRestartRequired: z.literal(false),
  }),
  z.object({
    committed: z.literal(true),
    committedPaths: z.array(z.string()),
    daemonRestartRequired: z.boolean(),
  }),
]);

export const decodeWorkflowCommitOutcome: CodeStepOutputValidator<WorkflowCommitOutcome> =
  (raw) => workflowCommitOutcomeSchema.parse(raw);
