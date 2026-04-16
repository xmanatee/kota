/**
 * Owner-questions module — exposes the `kota owner-question` operator CLI
 * and HTTP routes for the owner question queue. The queue state and review
 * gate live in `src/core/daemon/` as shared runtime primitives.
 */
import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import { registerOwnerQuestionCommands } from "./cli.js";
import { ownerQuestionRoutes } from "./routes.js";

export type {
  OwnerQuestionEnqueueInput,
  OwnerQuestionStatus,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
export {
  getOwnerQuestionQueue,
  OwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "#core/daemon/owner-question-queue.js";
export { reviewOwnerQuestion } from "#core/daemon/owner-question-review.js";

const ownerQuestionsModule: KotaModule = {
  name: "owner-questions",
  version: "1.0.0",
  description: "Owner-question queue operator CLI and HTTP routes for agent escalations",

  commands: () => {
    const root = new Command("__root__");
    registerOwnerQuestionCommands(root);
    return root.commands as Command[];
  },

  routes: () => ownerQuestionRoutes(),
};

export default ownerQuestionsModule;
