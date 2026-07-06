import { emitKeypressEvents } from "node:readline";
import type { NavigatorPrompt } from "./navigator-types.js";

type Keypress = {
  name?: string;
  ctrl?: boolean;
};

type TerminalInput = NodeJS.ReadStream & {
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
};

function keyCommand(str: string | undefined, key: Keypress): string {
  if (key.name === "return") return "enter";
  if (key.name === "up") return "up";
  if (key.name === "down") return "down";
  if (key.name === "tab") return "tab";
  if (key.name === "escape") return "noop";
  if (str === " ") return "enter";
  if (str === ":") return "palette";
  if (str === "w") return "work";
  if (str === "s") return "status";
  if (str === "i") return "inbox";
  if (str === "u") return "setup";
  if (str === "m") return "modules";
  if (str === "g") return "stores";
  if (str === "a") return "enter";
  if (str === "l") return "logs";
  return str ?? "noop";
}

function eraseEcho(stream: NodeJS.WritableStream): void {
  stream.write("\b \b");
}

function shouldMaskPaletteActionParameters(promptText: string, buffer: string): boolean {
  if (promptText !== "kota:tui> ") return false;
  const prefix = /^action\s+\S+\s+\S+\s+/i.exec(buffer);
  return prefix !== null && buffer.length > prefix[0].length;
}

export function createTerminalPrompt(
  input: TerminalInput = process.stdin,
  echo: NodeJS.WritableStream = process.stderr,
): NavigatorPrompt {
  const wasRaw = input.isRaw === true;
  let closed = false;
  const activeHandlers = new Set<(str: string | undefined, key?: Keypress) => void>();
  emitKeypressEvents(input);
  if (input.isTTY === true && input.setRawMode) input.setRawMode(true);
  input.resume();
  return {
    ask: (text) =>
      new Promise<string | null>((resolve) => {
        if (closed) {
          resolve(null);
          return;
        }
        let buffer = "";
        const lineMode = text.length > 0;
        if (lineMode) echo.write(text);
        const finish = (value: string | null) => {
          input.off("keypress", onKeypress);
          activeHandlers.delete(onKeypress);
          resolve(value);
        };
        const onKeypress = (str: string | undefined, key: Keypress = {}) => {
          if (key.ctrl && key.name === "c") {
            finish(null);
            return;
          }
          if (!lineMode) {
            finish(keyCommand(str, key));
            return;
          }
          if (key.name === "escape") {
            finish(text.length > 0 ? null : "noop");
            return;
          }
          if (key.name === "backspace" || key.name === "delete") {
            if (buffer.length > 0) {
              buffer = buffer.slice(0, -1);
              eraseEcho(echo);
            }
            return;
          }
          if (key.ctrl && key.name === "u") {
            while (buffer.length > 0) {
              buffer = buffer.slice(0, -1);
              eraseEcho(echo);
            }
            return;
          }
          if (key.name === "return") {
            echo.write("\n");
            finish(buffer);
            return;
          }
          if (str && str >= " " && str !== "\x7f") {
            for (const char of str) {
              if (char < " " || char === "\x7f") continue;
              buffer += char;
              echo.write(shouldMaskPaletteActionParameters(text, buffer) ? "*" : char);
            }
          }
        };
        activeHandlers.add(onKeypress);
        input.on("keypress", onKeypress);
      }),
    close: () => {
      if (closed) return;
      closed = true;
      for (const handler of activeHandlers) input.off("keypress", handler);
      activeHandlers.clear();
      if (input.isTTY === true && input.setRawMode) input.setRawMode(wasRaw);
      input.pause();
    },
  };
}
