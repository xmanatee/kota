import { resetSecretStores } from "#core/config/secrets.js";
import { EventBus, resetEventBus } from "#core/events/event-bus.js";
import { resetModuleEventRegistry } from "#core/events/module-event.js";
import { NullTransport } from "#core/loop/transport.js";
import { clearCustomTools } from "#core/tools/index.js";
import { clearCustomGroups, resetGroups } from "#core/tools/tool-groups.js";
import { ModuleLoader } from "./module-loader.js";
import {
  initProviderRegistry,
  RENDERING_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "./provider-registry.js";
import type { RenderingProvider, ReplChrome } from "./provider-types.js";

export const TEXT_LOG_CONFIG = { log: { format: "text" as const } };

export function createRuntimeModuleLoader(
  ...args: ConstructorParameters<typeof ModuleLoader>
): ModuleLoader {
  const loader = new ModuleLoader(...args);
  loader.setBus(new EventBus());
  return loader;
}

const noopChrome: ReplChrome = {
  announceHarness: () => {},
  showHelp: () => {},
  showStatus: () => {},
  showReset: () => {},
  showError: () => {},
  showGoodbye: () => {},
};

export function installRenderingCapture(chunks: string[]): void {
  const provider: RenderingProvider = {
    createAgentTransport: () => new NullTransport(),
    createReplChrome: () => noopChrome,
    printDiagnostic: (diagnostic) => {
      chunks.push(
        diagnostic.detail
          ? `${diagnostic.message}\n${diagnostic.detail}`
          : diagnostic.message,
      );
    },
    printPrompt: (prompt) => {
      chunks.push(prompt.kind);
    },
    writeStderr: (text) => {
      chunks.push(text);
    },
  };
  initProviderRegistry().register(RENDERING_PROVIDER_TOKEN, "test", provider);
}

export function resetModuleContextTestState(): void {
  clearCustomTools();
  clearCustomGroups();
  resetGroups();
  resetSecretStores();
  resetEventBus();
  resetModuleEventRegistry();
  resetProviderRegistry();
}
