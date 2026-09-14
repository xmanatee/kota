import { vi } from "vitest";
import { NullTransport } from "#core/loop/transport.js";
import { initProviderRegistry, RENDERING_PROVIDER_TOKEN, resetProviderRegistry } from "#core/modules/provider-registry.js";
import type { RenderingProvider } from "#core/modules/provider-types.js";

export function captureTerminalDiagnostics(mode: "provider" | "fallback" = "fallback") {
  resetProviderRegistry();
  const chunks: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  if (mode === "provider") {
    const provider: RenderingProvider = {
      createAgentTransport: () => new NullTransport(),
      createReplChrome: () => ({
        announceHarness() {}, showHelp() {}, showStatus() {}, showReset() {},
        showError() {}, showGoodbye() {},
      }),
      printDiagnostic: ({ message, detail }) => chunks.push(message, detail ?? ""),
      writeStderr: (text) => chunks.push(text),
      printPrompt() {},
    };
    initProviderRegistry().register(RENDERING_PROVIDER_TOKEN, "diagnostic-test", provider);
  }
  return {
    output: () => chunks.join(""),
    restore: () => { stderr.mockRestore(); resetProviderRegistry(); },
  };
}
