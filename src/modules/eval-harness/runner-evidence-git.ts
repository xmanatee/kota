import type { ExecutableVerifier } from "./executable-verifier-types.js";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Candidate Git metadata is untrusted, including after successful scoring. */
export async function collectWorkspaceDiff(
  workingDir: string,
  verifier: ExecutableVerifier | undefined,
): Promise<{ changedFiles: string[]; diff: string }> {
  if (verifier === undefined) {
    throw new Error("evidence collection requires a verified isolated verifier; refusing evaluator-host git execution");
  }
  const deadline = Date.now() + TIMEOUT_MS;
  let remainingBytes = MAX_OUTPUT_BYTES;
  const config = [
    "core.fsmonitor=false", "core.hooksPath=/dev/null", "core.sshCommand=false",
    "credential.helper=", "protocol.allow=never", "submodule.recurse=false",
  ];
  const git = async (args: string[], acceptedStatus = 0): Promise<string> => {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0 || remainingBytes <= 0) throw new Error("Git evidence collection exceeded its execution budget");
    const execution = await verifier({
      workingDir,
      command: [
        "env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "HOME=/tmp LANG=C LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null",
        "GIT_ATTR_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GIT_NO_LAZY_FETCH=1 GIT_OPTIONAL_LOCKS=0",
        "git --no-pager", ...config.flatMap((value) => ["-c", quote(value)]),
        ...args.map(quote),
      ].join(" "),
      timeoutMs,
      maxBuffer: remainingBytes,
    });
    if (!execution.started) throw new Error(execution.issue);
    const { result } = execution;
    if (result.error || result.signal || (result.status !== 0 && result.status !== acceptedStatus)) {
      throw new Error(`Isolated Git evidence failed: ${result.error?.message ?? (result.stderr.slice(-4_000) || result.signal || `exit ${result.status}`)}`);
    }
    remainingBytes -= Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
    if (remainingBytes < 0) throw new Error("Git evidence collection exceeded its output budget");
    return result.stdout;
  };

  // Diff's --no-textconv does not disable clean/process filters. Discover their
  // names inside isolation and override them, including included local config.
  const filters = await git(["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"], 1);
  for (const key of new Set(filters.split("\0").filter(Boolean))) {
    if (!/^filter\..+\.(clean|smudge|process|required)$/.test(key)) throw new Error("Invalid Git filter configuration key");
    config.push(`${key}=${key.endsWith(".required") ? "false" : ""}`);
  }
  const initial = (await git(["rev-list", "--max-parents=0", "HEAD"])).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(initial)) throw new Error("Invalid initial Git commit for evidence collection");
  const paths = [".", ":!.kota", ":!node_modules"];
  const diffArgs = ["diff", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all"];
  const tracked = (await git([...diffArgs, "--name-only", "-z", initial, "--", ...paths])).split("\0").filter(Boolean);
  const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...paths])).split("\0").filter(Boolean);
  let diff = await git([...diffArgs, initial, "--", ...paths]);
  for (const path of untracked) {
    // --no-index returns 1 for an ordinary difference, but errors and signals
    // must not be accepted as a partial patch.
    diff += await git([...diffArgs, "--no-index", "--", "/dev/null", path], 1);
  }
  return { changedFiles: [...new Set([...tracked, ...untracked])].sort(), diff };
}
