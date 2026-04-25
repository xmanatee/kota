/**
 * Owner-questions module — exposes the `kota owner-question` operator CLI
 * and HTTP routes for the owner question queue. The queue state and review
 * gate live in `src/core/daemon/` as shared runtime primitives.
 */
import { Command } from "commander";
import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { OwnerQuestionsClient } from "#core/server/kota-client.js";
import { registerOwnerQuestionCommands } from "./cli.js";
import { ownerQuestionControlRoutes, ownerQuestionRoutes } from "./routes.js";

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

const RESOLUTION_SOURCE = "cli";

const ownerQuestionsModule: KotaModule = {
  name: "owner-questions",
  version: "1.0.0",
  description: "Owner-question queue operator CLI and HTTP routes for agent escalations",
  dependencies: ["rendering"],

  commands: (ctx) => {
    const root = new Command("__root__");
    registerOwnerQuestionCommands(root, ctx);
    return root.commands as Command[];
  },

  routes: () => ownerQuestionRoutes(),
  controlRoutes: () => ownerQuestionControlRoutes(),

  localClient: () => {
    const handler: OwnerQuestionsClient = {
      async list(filter) {
        const queue = getOwnerQuestionQueue();
        const status = filter?.status;
        if (status === undefined) return { questions: queue.list("pending") };
        if (status === "all") return { questions: queue.list() };
        return { questions: queue.list(status) };
      },
      async answer(id, answer) {
        const item = getOwnerQuestionQueue().answer(id, answer, RESOLUTION_SOURCE);
        return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
      },
      async dismiss(id, reason) {
        const item = getOwnerQuestionQueue().dismiss(id, reason, RESOLUTION_SOURCE);
        return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
      },
    };
    return { ownerQuestions: handler };
  },
};

export default ownerQuestionsModule;
