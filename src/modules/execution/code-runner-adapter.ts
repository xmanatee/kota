/**
 * Adapts the execution module's REPL sessions to the core `CodeRunner`
 * protocol. Registered on module load, deregistered on unload. Owns the
 * language-specific parameter wrapping and output truncation so core never
 * needs to know the wire format.
 */

import {
  type CodeLanguage,
  type CodeRunner,
  type CodeRunResult,
  deregisterCodeRunner,
  registerCodeRunner,
} from "#core/tools/code-runner.js";
import { DEFAULT_TIMEOUT, MAX_OUTPUT } from "./code-wrappers.js";
import { sessions } from "./repl-session.js";

function createRunner(language: CodeLanguage): CodeRunner {
  return {
    language,
    async execute(code, params, timeoutMs): Promise<CodeRunResult> {
      const ms = timeoutMs ?? DEFAULT_TIMEOUT;
      const paramsJson = JSON.stringify(params);
      const b64 = Buffer.from(paramsJson).toString("base64");

      const wrapper =
        language === "python"
          ? `import json as __j, base64 as __b\nparams = __j.loads(__b.b64decode('${b64}').decode())\n${code}`
          : `const params = JSON.parse(Buffer.from('${b64}','base64').toString());\n${code}`;

      const session = sessions[language];
      const { output, isError } = await session.execute(wrapper, ms);

      const truncated =
        output.length > MAX_OUTPUT
          ? `${output.slice(0, MAX_OUTPUT)}\n[truncated — ${output.length} chars total]`
          : output;

      return { output: truncated, isError };
    },
  };
}

export const pythonCodeRunner = createRunner("python");
export const nodeCodeRunner = createRunner("node");

export function registerExecutionCodeRunners(): void {
  registerCodeRunner(pythonCodeRunner);
  registerCodeRunner(nodeCodeRunner);
}

export function deregisterExecutionCodeRunners(): void {
  deregisterCodeRunner("python");
  deregisterCodeRunner("node");
}
