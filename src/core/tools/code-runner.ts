/**
 * Core code-runner protocol.
 *
 * `custom_tool` and manifest-defined tools execute agent-authored Python or
 * Node.js code. Core owns the declarative surface (tool schema, manifest
 * parsing, persistence) but must not depend on any specific executor module.
 * Executors — the `execution` module today, any future runtime-module
 * tomorrow — register themselves here on load and deregister on unload.
 *
 * Zero registered executors is a legitimate state: core tolerates it and
 * `runCode` returns a loud error result at invocation time rather than
 * crashing or silently succeeding.
 */

export type CodeLanguage = "python" | "node";

export type CodeRunResult = {
  output: string;
  isError: boolean;
};

export type CodeRunner = {
  language: CodeLanguage;
  /**
   * Execute user `code` with JSON-serializable `params` injected into the
   * runtime as a `params` dict/object. The runner owns parameter wrapping,
   * default timeout, and output truncation.
   */
  execute(
    code: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<CodeRunResult>;
};

const runners = new Map<CodeLanguage, CodeRunner>();

export function registerCodeRunner(runner: CodeRunner): void {
  runners.set(runner.language, runner);
}

export function deregisterCodeRunner(language: CodeLanguage): boolean {
  return runners.delete(language);
}

export function getCodeRunner(language: CodeLanguage): CodeRunner | undefined {
  return runners.get(language);
}

export function supportedCodeLanguages(): CodeLanguage[] {
  return [...runners.keys()];
}

/** Reset the registry. Intended for tests. */
export function resetCodeRunners(): void {
  runners.clear();
}

export async function runCode(
  language: CodeLanguage,
  code: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<CodeRunResult> {
  const runner = runners.get(language);
  if (!runner) {
    return {
      output:
        `No code runner registered for language "${language}". ` +
        `Load a code-execution module (e.g. the "execution" module) ` +
        `or register a runner via registerCodeRunner(...).`,
      isError: true,
    };
  }
  return runner.execute(code, params, timeoutMs);
}
