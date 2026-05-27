import type { KotaModule } from "#core/modules/module-types.js";
import { a2aRoutes } from "./routes.js";

export { type A2AAgentCard, buildAgentCard } from "./agent-card.js";
export { type A2ABackend, DaemonA2ABackend } from "./daemon-session-client.js";
export {
  A2A_EXTENDED_CARD_PATH,
  A2A_RPC_PATH,
  A2A_WELL_KNOWN_CARD_PATH,
  A2AProtocolError,
  type A2ATask,
  type A2ATaskUpdate,
} from "./protocol.js";
export { a2aRoutes } from "./routes.js";

const a2aChannelModule: KotaModule = {
  name: "a2a-channel",
  version: "1.0.0",
  description:
    "Agent2Agent HTTP channel exposing KOTA daemon sessions through Agent Card discovery, JSON-RPC task methods, and SSE updates.",
  routes: (ctx) => a2aRoutes(ctx),
};

export default a2aChannelModule;
