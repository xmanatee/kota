type CleanupHook = {
  owner: string;
  run: () => void;
};

const cleanupHooks: CleanupHook[] = [];

export function registerCleanupHook(owner: string, run: () => void): void {
  cleanupHooks.push({ owner, run });
}

export function removeCleanupHooks(owner: string): void {
  let index = cleanupHooks.length - 1;
  while (index >= 0) {
    if (cleanupHooks[index]?.owner === owner) cleanupHooks.splice(index, 1);
    index -= 1;
  }
}

export function runCleanupHooks(): void {
  for (const hook of [...cleanupHooks].reverse()) {
    hook.run();
  }
}

export function resetCleanupHooks(): void {
  cleanupHooks.length = 0;
}
