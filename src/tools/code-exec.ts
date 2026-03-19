import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_TIMEOUT, MAX_OUTPUT } from "../data/code-wrappers.js";
import { extractPlots, readPlotFiles } from "../data/plot-capture.js";
import { cleanupSessions, findPythonBinary, type Language, type REPLSession, sessions } from "../repl-session.js";
import type { ToolResult, ToolResultBlock } from "./index.js";
import { which } from "./runtime-check.js";

export { cleanupSessions };

const execFileP = promisify(execFileCb);

export const codeExecTool: Anthropic.Tool = {
  name: "code_exec",
  description:
    "Execute code in a persistent REPL session. Variables, imports, and state persist " +
    "across calls — ideal for iterative data analysis, computation, math, prototyping, " +
    "and exploration. Supports Python and Node.js (each has its own session).",
  input_schema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "The code to execute",
      },
      language: {
        type: "string",
        enum: ["python", "node"],
        description: "Language runtime (default: python)",
      },
      timeout_ms: {
        type: "number",
        description: "Execution timeout in ms (default: 30000)",
      },
      reset: {
        type: "boolean",
        description: "Reset the session (kill and restart) before executing",
      },
    },
    required: ["code"],
  },
};

export async function runCodeExec(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const code = input.code as string;
  const language = (input.language as Language) || "python";
  const timeoutMs = (input.timeout_ms as number) || DEFAULT_TIMEOUT;
  const reset = (input.reset as boolean) || false;

  if (!code) {
    return { content: "Error: code is required", is_error: true };
  }
  if (language !== "python" && language !== "node") {
    return {
      content: `Error: language must be "python" or "node", got "${language}"`,
      is_error: true,
    };
  }

  // Check runtime availability
  const cmd = language === "python" ? "python3" : "node";
  if (!which(cmd)) {
    return {
      content: `Error: ${cmd} not found. Install ${language === "python" ? "Python 3" : "Node.js"} to use code_exec with language="${language}".`,
      is_error: true,
    };
  }

  const session = sessions[language];
  if (reset) session.kill();

  let { output, isError } = await session.execute(code, timeoutMs);

  // Auto-install missing packages and retry (one attempt)
  const missingPkg = extractMissingPackage(output, language);
  if (missingPkg) {
    const retry = await tryAutoInstall(missingPkg, code, language, session, timeoutMs);
    if (retry) {
      output = retry.output;
      isError = retry.isError;
    }
  }

  // Separate plot markers from text output (Python matplotlib auto-capture)
  const { text: cleanOutput, plotPaths } = extractPlots(output);

  const truncated =
    cleanOutput.length > MAX_OUTPUT
      ? cleanOutput.slice(0, MAX_OUTPUT) +
        `\n[truncated — ${cleanOutput.length} chars total]`
      : cleanOutput;

  const pyBin = language === "python" ? findPythonBinary(process.cwd()) : undefined;
  const hint = detectPackageHint(truncated, language, pyBin);
  const content = hint ? `${truncated}\n\n${hint}` : truncated;

  const imageBlocks = readPlotFiles(plotPaths);
  if (imageBlocks.length > 0) {
    const blocks: ToolResultBlock[] = [
      { type: "text", text: content },
      ...imageBlocks,
    ];
    return { content, blocks, is_error: isError };
  }

  return { content, is_error: isError };
}

/** Detect missing package errors and suggest install commands. */
export function detectPackageHint(output: string, language: Language, pythonBinary?: string): string | null {
  if (language === "python") {
    const match = output.match(/ModuleNotFoundError: No module named '([^']+)'/);
    if (match) {
      const pkg = match[1].split(".")[0];
      const installCmd = pythonBinary && pythonBinary !== "python3"
        ? `${pythonBinary} -m pip install ${pkg}`
        : `pip install ${pkg}`;
      return `Tip: Install the missing package with shell: ${installCmd}`;
    }
  } else {
    const match = output.match(/Cannot find module '([^']+)'/);
    if (match) {
      const pkg = match[1];
      if (!pkg.startsWith(".") && !pkg.startsWith("/")) {
        return `Tip: Install the missing package with shell: npm install ${pkg}`;
      }
    }
  }
  return null;
}

/** Extract the missing package name from an import error. */
export function extractMissingPackage(output: string, language: string): string | null {
  if (language === "python") {
    const m = output.match(/ModuleNotFoundError: No module named '([^']+)'/);
    if (!m) return null;
    const pkg = m[1].split(".")[0];
    return /^[a-zA-Z0-9_-]+$/.test(pkg) ? pkg : null;
  }
  if (language === "node") {
    const m = output.match(/Cannot find module '([^']+)'/);
    if (!m) return null;
    const raw = m[1];
    if (raw.startsWith(".") || raw.startsWith("/")) return null;
    // Extract package name: @scope/name or name (strip subpaths)
    const pkgName = raw.startsWith("@")
      ? raw.split("/").slice(0, 2).join("/")
      : raw.split("/")[0];
    return /^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(pkgName) ? pkgName : null;
  }
  return null;
}

/** Auto-install a missing package and re-run the code. Returns null on failure. */
async function tryAutoInstall(
  pkg: string,
  code: string,
  language: Language,
  session: REPLSession,
  timeoutMs: number,
): Promise<{ output: string; isError: boolean } | null> {
  try {
    if (language === "python") {
      const bin = findPythonBinary(process.cwd());
      await execFileP(bin, ["-m", "pip", "install", "--quiet", pkg], {
        timeout: 60_000,
      });
    } else {
      await execFileP("npm", ["install", "--no-save", pkg], {
        timeout: 60_000,
      });
    }
  } catch {
    return null;
  }
  const retryCode = language === "python"
    ? `import importlib; importlib.invalidate_caches()\n${code}`
    : code;
  const result = await session.execute(retryCode, timeoutMs);
  const installer = language === "python" ? "pip" : "npm";
  return {
    output: `[Auto-installed ${pkg} via ${installer}]\n${result.output}`,
    isError: result.isError,
  };
}
export const registration = {
	tool: codeExecTool,
	runner: runCodeExec,
	risk: "moderate" as const,
	group: "code",
};
