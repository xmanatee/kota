import type { KotaModule } from "#core/modules/module-types.js";
import { repoAiChecksCompletedEvent } from "./events.js";

const repoAiChecksModule: KotaModule = {
  name: "repo-ai-checks",
  version: "1.0.0",
  description: "Repo-local AI check-file discovery and result event contracts",
  events: [repoAiChecksCompletedEvent],
};

export default repoAiChecksModule;
