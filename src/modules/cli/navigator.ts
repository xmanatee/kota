import type { UiSurfaceBundle } from "#modules/daemon-ops/operator-ui.js";
import { statusBanner } from "#modules/rendering/primitives.js";
import {
  renderToString,
  TerminalScreenSession,
  type TerminalTransport,
} from "#modules/rendering/transport.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import {
  executeActionCommand,
  executeSelectedAction,
} from "./navigator-action-execution.js";
import {
  parseNavigatorInput,
  reduceNavigatorState,
} from "./navigator-commands.js";
import { collectLiveEventTypes } from "./navigator-live-events.js";
import { renderNavigatorFrame } from "./navigator-render.js";
import {
  createNavigatorState,
  markLiveEvent,
  markLiveSubscribed,
  type NavigatorKeymap,
  type NavigatorState,
  type NavigatorThemePreference,
  withBundle,
} from "./navigator-state.js";
import type { NavigatorOutput, NavigatorPrompt } from "./navigator-types.js";

export { createTerminalPrompt } from "./navigator-terminal-prompt.js";
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

export function createTerminalScreenOutput(transport: TerminalTransport): NavigatorOutput {
  const session = new TerminalScreenSession({ stream: transport.stream });
  session.start();
  return {
    write: (node) => session.writeFrame(renderToString(node, transport.context())),
    close: () => session.stop(),
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
      const raw = await prompt.ask(state.view.kind === "palette" ? "kota:tui> " : "");
      if (raw === null) return;
      const command = parseNavigatorInput(raw, state);
      if (command.type === "quit") return;
      if (command.type === "refresh") {
        state = withBundle(state, await loadBundle(client, output));
        output.write(renderNavigatorFrame(state));
        continue;
      }
      if (command.type === "action") {
        const message = await executeActionCommand(command.raw, client, prompt, state.bundle);
        state = { ...withBundle(state, await loadBundle(client, output)), message };
        output.write(renderNavigatorFrame(state));
        continue;
      }
      if (command.type === "open-selected" && state.focus === "actions") {
        const message = await executeSelectedAction(state, client, prompt);
        state = { ...withBundle(state, await loadBundle(client, output)), message };
        output.write(renderNavigatorFrame(state));
        continue;
      }
      state = reduceNavigatorState(state, command);
      output.write(renderNavigatorFrame(state));
    }
  } finally {
    resizeUnsubscribe?.();
    await liveUpdates.stop();
    output.close?.();
    prompt.close();
  }
}
