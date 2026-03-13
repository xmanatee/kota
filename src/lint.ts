import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { extname } from "node:path";

export type LintResult = { ok: true } | { ok: false; error: string };

/**
 * Run a syntax check on a file based on its extension.
 * Returns ok:true if the file passes or if no checker is available.
 * Returns ok:false with the error message if syntax is broken.
 */
export function lintFile(path: string): LintResult {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".json":
      return lintJSON(path);
    case ".js":
    case ".cjs":
    case ".mjs":
      return lintJS(path);
    case ".ts":
    case ".tsx":
    case ".jsx":
    case ".mts":
    case ".cts":
      return lintWithEsbuild(path, ext);
    case ".py":
      return lintPython(path);
    default:
      return { ok: true };
  }
}

function lintJSON(path: string): LintResult {
  try {
    JSON.parse(readFileSync(path, "utf-8"));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function lintJS(path: string): LintResult {
  try {
    execSync(`node --check "${path}"`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    });
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: string };
    return { ok: false, error: e.stderr || (err as Error).message };
  }
}

function lintWithEsbuild(path: string, ext: string): LintResult {
  const loader = ext === ".tsx" || ext === ".jsx" ? "tsx" : "ts";
  const escaped = path.replace(/'/g, "'\\''");
  const cmd =
    `node -e "require('esbuild').transformSync(` +
    `require('fs').readFileSync('${escaped}','utf-8'),` +
    `{loader:'${loader}'})"`;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe", timeout: 10_000 });
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message || "";
    // If esbuild isn't available, skip the check gracefully
    if (msg.includes("Cannot find module") || msg.includes("MODULE_NOT_FOUND")) {
      return { ok: true };
    }
    const e = err as { stderr?: string };
    return { ok: false, error: extractEsbuildError(e.stderr || msg) };
  }
}

function lintPython(path: string): LintResult {
  const escaped = path.replace(/'/g, "'\\''");
  try {
    execSync(
      `python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" '${escaped}'`,
      { encoding: "utf-8", stdio: "pipe", timeout: 10_000 },
    );
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      return { ok: true }; // python3 not available, skip
    }
    const e = err as { stderr?: string };
    return { ok: false, error: e.stderr || msg };
  }
}

/** Extract the useful part of esbuild's error output */
function extractEsbuildError(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.includes("ERROR") || l.includes("error") || l.trim().startsWith(">") || l.trim().startsWith("|") || l.trim().startsWith("^"));
  return lines.length > 0 ? lines.slice(0, 10).join("\n") : raw.slice(0, 500);
}
