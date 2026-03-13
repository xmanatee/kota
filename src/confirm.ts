import { createInterface } from "node:readline";

const DANGEROUS_PATTERNS = [
  /\brm\s/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+clean\b/,
  /\bgit\s+checkout\s+\./,
  /\bdocker\s+rm\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s/,
  /\bkill\b/,
  /\bchmod\b.*777/,
  /\b(npm|pnpm|yarn)\s+publish\b/,
  />\s*\/dev\/sd/,
];

let skipConfirmations = false;

export function setSkipConfirmations(skip: boolean): void {
  skipConfirmations = skip;
}

export function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

export async function confirmExecution(command: string): Promise<boolean> {
  if (skipConfirmations) return true;
  if (!process.stdin.isTTY) return false;

  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    rl.question(
      `\n⚠ Destructive command detected:\n  ${command}\nProceed? [y/N] `,
      (answer) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        resolve(a === "y" || a === "yes");
      },
    );
  });
}
