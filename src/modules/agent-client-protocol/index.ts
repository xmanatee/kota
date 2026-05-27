import type { KotaModule } from "#core/modules/module-types.js";
import { buildAgentClientProtocolCommand } from "./cli.js";

export {
  type AcpDaemonClient,
  HttpAcpDaemonClient,
} from "./daemon-adapter.js";
export { AgentClientProtocolServer } from "./server.js";
export { runAgentClientProtocolStdio } from "./stdio.js";

const agentClientProtocolModule: KotaModule = {
  name: "agent-client-protocol",
  version: "1.0.0",
  description: "Agent Client Protocol stdio adapter backed by daemon sessions",
  commands: () => [buildAgentClientProtocolCommand()],
};

export default agentClientProtocolModule;
