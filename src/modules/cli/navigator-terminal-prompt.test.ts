import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createTerminalPrompt } from "./navigator.js";

function makeTtyInput(): EventEmitter & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
  resume: () => void;
  pause: () => void;
} {
  const input = new EventEmitter() as EventEmitter & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: (mode: boolean) => void;
    resume: () => void;
    pause: () => void;
  };
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = vi.fn((mode: boolean) => {
    input.isRaw = mode;
  });
  input.resume = vi.fn();
  input.pause = vi.fn();
  return input;
}

describe("navigator terminal prompt", () => {
  it("reads direct raw keys on the TTY path and reserves prompt text for line commands", async () => {
    const input = makeTtyInput();
    let echoed = "";
    const prompt = createTerminalPrompt(input as unknown as NodeJS.ReadStream, {
      write: (chunk: string) => {
        echoed += chunk;
        return true;
      },
    } as unknown as NodeJS.WritableStream);

    const rawAnswer = prompt.ask("");
    input.emit("keypress", "j", { name: "j" });
    await expect(rawAnswer).resolves.toBe("j");
    expect(echoed).toBe("");

    const lineAnswer = prompt.ask("kota:tui> ");
    input.emit("keypress", "r", { name: "r" });
    input.emit("keypress", undefined, { name: "return" });
    await expect(lineAnswer).resolves.toBe("r");
    expect(echoed).toBe("kota:tui> r\n");

    prompt.close();
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("masks command-palette action parameters before they reach the terminal transcript", async () => {
    const input = makeTtyInput();
    let echoed = "";
    const prompt = createTerminalPrompt(input as unknown as NodeJS.ReadStream, {
      write: (chunk: string) => {
        echoed += chunk;
        return true;
      },
    } as unknown as NodeJS.WritableStream);

    const raw = 'action setup setup.secret {"token":"super-secret"}';
    const answer = prompt.ask("kota:tui> ");
    for (const char of raw) input.emit("keypress", char, { name: char });
    input.emit("keypress", undefined, { name: "return" });

    await expect(answer).resolves.toBe(raw);
    expect(echoed).toContain("kota:tui> action setup setup.secret ");
    expect(echoed).not.toContain("super-secret");
    expect(echoed).not.toContain('{"token"');
    expect(echoed).toMatch(/\*{10,}/);

    prompt.close();
  });
});
