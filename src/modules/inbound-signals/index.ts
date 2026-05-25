import type { KotaModule } from "#core/modules/module-types.js";
import { inboundSignalReceived } from "./events.js";

export * from "./events.js";

const inboundSignalsModule: KotaModule = {
  name: "inbound-signals",
  version: "1.0.0",
  description:
    "Typed project-scoped inbound external signal contract for workflow automation",
  events: [inboundSignalReceived],
};

export default inboundSignalsModule;
