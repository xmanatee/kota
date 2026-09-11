type CleanupHook = {
  run: () => void;
};

const cleanupHooks: CleanupHook[] = [];

export function registerCleanupHook(run: () => void): () => void {
  const entry = { run };
  cleanupHooks.push(entry);
  return () => {
    const index = cleanupHooks.indexOf(entry);
    if (index >= 0) cleanupHooks.splice(index, 1);
  };
}

export function runCleanupHooks(): void {
  for (const hook of [...cleanupHooks].reverse()) {
    hook.run();
  }
}

export function resetCleanupHooks(): void {
  cleanupHooks.length = 0;
}
