import { createInterface } from "node:readline";

let skipConfirmations = false;

export function setSkipConfirmations(skip: boolean): void {
  skipConfirmations = skip;
}

/** Prompt the user for confirmation before a destructive action. Returns true if confirmed. */
export async function confirmAction(message: string): Promise<boolean> {
  if (skipConfirmations) return true;
  if (!process.stdin.isTTY) return false;

  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}
