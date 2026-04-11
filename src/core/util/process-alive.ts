/**
 * Returns true if a process with the given PID is alive (or the caller lacks
 * permission to signal it, which also implies it exists).
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
