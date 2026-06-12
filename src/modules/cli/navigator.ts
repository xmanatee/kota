import { createInterface } from "node:readline";
import type { KotaClient } from "#core/server/kota-client.js";
import {
  blank,
  heading,
  line,
  list,
  plain,
  type RenderNode,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { openScreen } from "./navigator-screens.js";
import type { NavigatorOutput, NavigatorPrompt, ScreenName } from "./navigator-types.js";

export type { NavigatorOutput, NavigatorPrompt } from "./navigator-types.js";

export type NavigatorOptions = {
  client: KotaClient;
  prompt: NavigatorPrompt;
  output: NavigatorOutput;
};

type MenuEntry = { key: string; label: string; screen: ScreenName };

const MENU: MenuEntry[] = [
  { key: "1", label: "Status", screen: "status" },
  { key: "2", label: "Inbox", screen: "inbox" },
  { key: "3", label: "Work", screen: "work" },
  { key: "4", label: "Knowledge", screen: "knowledge" },
  { key: "5", label: "Setup", screen: "setup" },
];

export const NON_TTY_HINT =
  'kota navigate is interactive only. Run a one-shot subcommand instead — e.g. "kota status", "kota inbox", "kota workflow status".';

export function refuseNonTtyLaunch(stderr: NodeJS.WritableStream): void {
  stderr.write(`${NON_TTY_HINT}\n`);
}

export function renderMainMenu(): RenderNode {
  return stack(
    heading("KOTA operator console", 1),
    line(span("Pick an intent, q to quit, ? for help.", "muted")),
    blank(),
    list(MENU.map((entry) => ({
      spans: [
        span(`${entry.key} `, "accent", true),
        plain(entry.label),
      ],
    }))),
    blank(),
  );
}

export async function runNavigator(opts: NavigatorOptions): Promise<void> {
  const { client, prompt, output } = opts;
  try {
    output.write(renderMainMenu());
    while (true) {
      const raw = await prompt.ask("kota> ");
      if (raw === null) return;
      const input = raw.trim().toLowerCase();
      if (input === "" || input === "?" || input === "h" || input === "help") {
        output.write(renderMainMenu());
        continue;
      }
      if (input === "q" || input === "quit" || input === "exit") return;
      const entry = MENU.find((m) => m.key === input || m.label.toLowerCase().startsWith(input));
      if (!entry) {
        output.write(line(span(`Unknown selection "${raw}". Type ? for the menu, q to quit.`, "warn")));
        continue;
      }
      await openScreen(entry.screen, client, prompt, output);
      output.write(renderMainMenu());
    }
  } finally {
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
