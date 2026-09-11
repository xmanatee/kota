/** Core tool composition. Implementations consume the registry; this entry point installs them. */
import { registration as agentStatus } from "./agent-status.js";
import { registration as approval } from "./approval.js";
import { registration as askOwner } from "./ask-owner.js";
import { registration as askUser } from "./ask-user.js";
import { registration as checkpoint } from "./checkpoint.js";
import { registration as confirm } from "./confirm.js";
import { registration as delegate } from "./delegate.js";
import { registration as handoffAgent } from "./handoff-agent-registration.js";
import { registration as moduleFactory } from "./module-factory/index.js";
import { registration as todo } from "./todo.js";
import { installCoreTools } from "./tool-registry.js";

export { getTodoState } from "./todo.js";
export * from "./tool-registry.js";

installCoreTools([
  agentStatus, approval, todo, delegate, handoffAgent, askUser, askOwner,
  confirm, checkpoint, moduleFactory,
]);
