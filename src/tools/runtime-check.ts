import { execFileSync } from "node:child_process";

/** Check if a command exists on the system PATH. */
export function which(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
