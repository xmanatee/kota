import { onTestFinished, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "./module-loader.js";

export const TEXT_LOG_CONFIG = { log: { format: "text" as const } };

/** Compose the real host; every test releases its own registrations on exit. */
export function createModuleLoader(
  ...args: ConstructorParameters<typeof ModuleLoader>
): ModuleLoader {
  const loader = new ModuleLoader(args[0], args[1], { mode: "runtime", ...args[2] });
  if (loader.getMode() === "runtime") loader.setBus(new EventBus());
  onTestFinished(() => loader.unloadAll());
  return loader;
}

export function captureDiagnostics(chunks: string[]): void {
  const output = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  onTestFinished(() => output.mockRestore());
}
