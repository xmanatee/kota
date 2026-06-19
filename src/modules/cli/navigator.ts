import { createInterface } from "node:readline";
import type { KotaClient } from "#core/server/kota-client.js";
import type {
  UiAction,
  UiJsonValue,
  UiSurface,
  UiSurfaceBundle,
} from "#modules/daemon-ops/operator-ui.js";
import {
  line,
  type RenderNode,
  span,
  statusBanner,
} from "#modules/rendering/primitives.js";
import {
  collectLiveEventTypes,
  createNavigatorState,
  markLiveEvent,
  markLiveSubscribed,
  type NavigatorKeymap,
  type NavigatorState,
  type NavigatorThemePreference,
  parseNavigatorInput,
  reduceNavigatorState,
  renderNavigatorFrame,
  withBundle,
} from "./navigator-state.js";
import type { NavigatorOutput, NavigatorPrompt } from "./navigator-types.js";

export type { NavigatorOutput, NavigatorPrompt } from "./navigator-types.js";

export type NavigatorResizeSource = {
  width(): number;
  subscribe(handler: (width: number) => void): () => void;
};

export type NavigatorOptions = {
  client: KotaClient;
  prompt: NavigatorPrompt;
  output: NavigatorOutput;
  keymap?: NavigatorKeymap;
  theme?: NavigatorThemePreference;
  resizeSource?: NavigatorResizeSource;
};

const EMPTY_SURFACE_BUNDLE: UiSurfaceBundle = {
  protocolVersion: "ui.surface.v1",
  surfaces: [],
};

export const NON_TTY_HINT =
  'kota navigate is interactive only. Run a one-shot subcommand instead — e.g. "kota ui render", "kota inbox", or "kota run <prompt>".';

export function refuseNonTtyLaunch(stderr: NodeJS.WritableStream): void {
  stderr.write(`${NON_TTY_HINT}\n`);
}

export function createStdoutResizeSource(stdout: NodeJS.WriteStream = process.stdout): NavigatorResizeSource {
  return {
    width: () => stdout.columns || 100,
    subscribe: (handler) => {
      const onResize = () => handler(stdout.columns || 100);
      stdout.on("resize", onResize);
      return () => stdout.off("resize", onResize);
    },
  };
}

async function loadBundle(client: KotaClient, output: NavigatorOutput): Promise<UiSurfaceBundle> {
  try {
    return await client.ui.listSurfaces();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.write(statusBanner("error", "Unable to load shared UI surfaces", msg));
    return EMPTY_SURFACE_BUNDLE;
  }
}

function parseActionCommand(raw: string): {
  surfaceId: string;
  actionId: string;
  parameters?: UiJsonValue;
  confirmed: boolean;
} | { error: string } {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 3) {
    return { error: 'Expected action <surface-id> <action-id> [--yes] [json-parameters].' };
  }
  const [, surfaceId, actionId, ...rest] = parts;
  let confirmed = false;
  const jsonParts: string[] = [];
  for (const part of rest) {
    if (part === "--yes" || part === "-y") {
      confirmed = true;
      continue;
    }
    jsonParts.push(part);
  }
  if (jsonParts.length === 0) {
    return { surfaceId, actionId, confirmed };
  }
  const rawJson = jsonParts.join(" ");
  try {
    return {
      surfaceId,
      actionId,
      confirmed,
      parameters: JSON.parse(rawJson) as UiJsonValue,
    };
  } catch (err) {
    return {
      error: `Action parameters must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function findAction(surface: UiSurface, actionId: string): UiAction | null {
  return surface.actions.find((action) => action.actionId === actionId) ?? null;
}

function renderActionResult(result: Awaited<ReturnType<KotaClient["ui"]["executeAction"]>>): RenderNode {
  if (result.ok) return statusBanner("success", "UI action executed", result.message);
  return statusBanner("error", `UI action failed: ${result.reason}`, result.message);
}

async function executeActionCommand(
  raw: string,
  client: KotaClient,
  prompt: NavigatorPrompt,
  output: NavigatorOutput,
  bundle: UiSurfaceBundle,
): Promise<void> {
  const parsed = parseActionCommand(raw);
  if ("error" in parsed) {
    output.write(line(span(parsed.error, "warn")));
    return;
  }
  const surface = bundle.surfaces.find((candidate) => candidate.surfaceId === parsed.surfaceId);
  if (!surface) {
    output.write(line(span(`Unknown surface "${parsed.surfaceId}".`, "warn")));
    return;
  }
  const action = findAction(surface, parsed.actionId);
  if (!action) {
    output.write(line(span(`Unknown action "${parsed.actionId}" on ${surface.surfaceId}.`, "warn")));
    return;
  }
  if (action.readiness.state === "disabled") {
    output.write(statusBanner("warn", `${action.label} is disabled`, action.readiness.message));
    return;
  }
  if (action.confirmation.mode === "required" && !parsed.confirmed) {
    const answer = await prompt.ask(`${action.confirmation.title} — type ${JSON.stringify(action.confirmation.confirmLabel)} to continue: `);
    if (answer === null || answer.trim() !== action.confirmation.confirmLabel) {
      output.write(line(span(`Skipped ${surface.surfaceId}/${action.actionId}.`, "warn")));
      return;
    }
  }
  const result = await client.ui.executeAction({
    surfaceId: parsed.surfaceId,
    actionId: parsed.actionId,
    parameters: parsed.parameters,
  });
  output.write(renderActionResult(result));
}

function startLiveUpdateLoop(args: {
  client: KotaClient;
  output: NavigatorOutput;
  readState: () => NavigatorState;
  writeState: (state: NavigatorState) => void;
}): { stop(): Promise<void> } {
  const controller = new AbortController();
  const task = (async () => {
    let state = args.readState();
    const eventTypes = collectLiveEventTypes(state.bundle);
    state = markLiveSubscribed(state, eventTypes.length > 0);
    args.writeState(state);
    if (eventTypes.length === 0) return;
    for await (const event of args.client.ui.watchEvents({ eventTypes, signal: controller.signal })) {
      const nextBundle = await loadBundle(args.client, args.output);
      state = markLiveEvent(withBundle(args.readState(), nextBundle), event);
      args.writeState(state);
      args.output.write(renderNavigatorFrame(state));
    }
  })().catch((error) => {
    if (!controller.signal.aborted) {
      args.output.write(statusBanner("warn", "Live UI updates stopped", error instanceof Error ? error.message : String(error)));
    }
  });
  return {
    async stop() {
      controller.abort();
      await task;
    },
  };
}

export async function runNavigator(opts: NavigatorOptions): Promise<void> {
  const { client, prompt, output } = opts;
  let state = createNavigatorState({
    bundle: await loadBundle(client, output),
    width: opts.resizeSource?.width(),
    theme: opts.theme,
    keymap: opts.keymap,
  });
  const setState = (next: NavigatorState) => {
    state = next;
  };
  const resizeUnsubscribe = opts.resizeSource?.subscribe((width) => {
    state = reduceNavigatorState(state, { type: "resize", width });
    output.write(renderNavigatorFrame(state));
  });
  const liveUpdates = startLiveUpdateLoop({
    client,
    output,
    readState: () => state,
    writeState: setState,
  });

  try {
    output.write(renderNavigatorFrame(state));
    while (true) {
      const raw = await prompt.ask("kota:tui> ");
      if (raw === null) return;
      const command = parseNavigatorInput(raw, state);
      if (command.type === "quit") return;
      if (command.type === "refresh") {
        state = withBundle(state, await loadBundle(client, output));
        output.write(renderNavigatorFrame(state));
        continue;
      }
      if (command.type === "action") {
        await executeActionCommand(command.raw, client, prompt, output, state.bundle);
        continue;
      }
      state = reduceNavigatorState(state, command);
      output.write(renderNavigatorFrame(state));
    }
  } finally {
    resizeUnsubscribe?.();
    await liveUpdates.stop();
    prompt.close();
  }
}

export function createReadlinePrompt(): NavigatorPrompt {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: process.stdin.isTTY === true,
  });
  return {
    ask: (text) =>
      new Promise<string | null>((resolve) => {
        let resolved = false;
        const onClose = () => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        };
        rl.once("close", onClose);
        rl.question(text, (answer) => {
          rl.removeListener("close", onClose);
          if (resolved) return;
          resolved = true;
          resolve(answer);
        });
      }),
    close: () => rl.close(),
  };
}
