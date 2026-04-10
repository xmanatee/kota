import type { Command, Option } from "commander";
import { Command as CommandClass } from "commander";
import type { KotaModule } from "../../module-types.js";

/** Walk a command tree and collect name + description pairs for each level. */
function getSubcommands(cmd: Command): Array<{ name: string; description: string }> {
  return cmd.commands.map((sub) => ({
    name: sub.name(),
    description: sub.description().split("\n")[0],
  }));
}

/** Collect all long option flags for a command (e.g. --status, --workflow). */
function getOptions(cmd: Command): string[] {
  return cmd.options
    .map((o: Option) => o.long)
    .filter((s): s is string => Boolean(s));
}

/** Build a map of "word path" → options for bash case blocks. */
function collectPaths(
  cmd: Command,
  prefix: string[],
  result: Map<string, { subs: string[]; opts: string[] }>,
): void {
  const key = prefix.join(" ");
  result.set(key, {
    subs: getSubcommands(cmd).map((s) => s.name),
    opts: getOptions(cmd),
  });
  for (const sub of cmd.commands) {
    collectPaths(sub, [...prefix, sub.name()], result);
  }
}

function generateBash(program: Command): string {
  const paths = new Map<string, { subs: string[]; opts: string[] }>();
  collectPaths(program, ["kota"], paths);

  const cases: string[] = [];

  for (const [path, { subs, opts }] of paths) {
    const words = path.split(" ");
    // Case pattern matches on the relevant word depth
    const depth = words.length; // "kota" = 1, "kota workflow" = 2, ...
    const completions = [...subs, ...opts].join(" ");
    if (!completions) continue;

    // We match by looking at words up to this depth
    const pattern =
      depth === 1
        ? "*" // top-level: always offer top-level subs
        : words.slice(1).join(" "); // e.g. "workflow" or "workflow list"

    cases.push(
      depth === 1
        ? `    _top="${completions}"`
        : `    ${JSON.stringify(pattern)}) COMPREPLY=($(compgen -W ${JSON.stringify(completions)} -- "$cur")) ; return ;;`,
    );
  }

  const topLine = cases.shift() ?? '    _top=""';

  return `# kota bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   source <(kota completion bash)

_kota_completion() {
  local cur prev words cword
  COMPREPLY=()
  if type _init_completion &>/dev/null; then
    _init_completion || return
  else
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    words=("\${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  fi

  local _top
${topLine}

  # Build the sub-path from words[1..] skipping the current word
  local path=""
  local i
  for (( i=1; i<cword; i++ )); do
    [[ "\${words[i]}" == -* ]] && continue
    path+=" \${words[i]}"
  done
  path="\${path# }"  # strip leading space

  case "$path" in
${cases.join("\n")}
    *) COMPREPLY=($(compgen -W "$_top" -- "$cur")) ;;
  esac
}

complete -F _kota_completion kota
`;
}

function generateZsh(program: Command): string {
  const topSubs = getSubcommands(program);
  const topOpts = getOptions(program);

  // Build subcmd descriptors: 'name:description'
  const topDescriptors = topSubs
    .map((s) => `'${s.name.replace("'", "'\\''")}: ${s.description.replace("'", "'\\''")}'`)
    .join("\n    ");

  // Build nested case entries for each top-level subcommand
  const nestedCases: string[] = [];
  for (const topSub of program.commands) {
    const subs = getSubcommands(topSub);
    const opts = getOptions(topSub);
    if (subs.length === 0 && opts.length === 0) continue;

    const subDescriptors = subs
      .map((s) => `      '${s.name.replace("'", "'\\''")}: ${s.description.replace("'", "'\\''")}'`)
      .join("\n");

    const optFlags = opts.map((o) => `      '${o}'`).join("\n");

    let inner = "";
    if (subs.length > 0) {
      inner += `
      local -a _subcmds
      _subcmds=(
${subDescriptors}
      )
      _describe '${topSub.name()} command' _subcmds`;
    }
    if (opts.length > 0) {
      inner += `
      _arguments \\
${optFlags.replace(/\n/g, " \\\n")}`;
    }

    nestedCases.push(`    (${topSub.name()})${inner}\n      ;;`);
  }

  const topOptFlags =
    topOpts.length > 0
      ? `${topOpts.map((o) => `    '${o}'`).join(" \\\n")} \\`
      : "";

  return `#compdef kota
# kota zsh completion
# Add to ~/.zshrc:
#   source <(kota completion zsh)
# Or for fpath-based completion:
#   kota completion zsh > "\${fpath[1]}/_kota"

_kota() {
  local curcontext="$curcontext" state line
  typeset -A opt_args

  _arguments -C \\
${topOptFlags}
    '1: :->cmd' \\
    '*: :->args'

  case $state in
    cmd)
      local -a _cmds
      _cmds=(
    ${topDescriptors}
      )
      _describe 'kota command' _cmds
      ;;
    args)
      case $words[2] in
${nestedCases.join("\n")}
      esac
      ;;
  esac
}

_kota "$@"
`;
}

function detectShell(): string | undefined {
  const shellEnv = process.env.SHELL ?? "";
  if (shellEnv.includes("zsh")) return "zsh";
  if (shellEnv.includes("bash")) return "bash";
  return undefined;
}

/** Traverse commander parents to reach the root program. */
function getRoot(cmd: Command): Command {
  let root: Command = cmd;
  while (root.parent) root = root.parent;
  return root;
}

const completionModule: KotaModule = {
  name: "completion",
  version: "1.0.0",
  description: "Shell completion script generator for bash and zsh",

  commands: () => {
    const cmd = new CommandClass("completion")
      .description("Print shell completion script (bash or zsh). Source it to enable tab completion.")
      .argument("[shell]", "Shell type: bash or zsh (auto-detected from $SHELL if omitted)")
      .action(function (this: Command, shell: string | undefined) {
        const program = getRoot(this);
        const detected = shell ?? detectShell();
        if (detected === "zsh") {
          process.stdout.write(generateZsh(program));
        } else if (detected === "bash") {
          process.stdout.write(generateBash(program));
        } else {
          console.error(
            `Unknown shell: ${detected ?? "(none detected)"}\nSupported: bash, zsh\n\nUsage: kota completion bash  OR  kota completion zsh`,
          );
          process.exit(1);
        }
      });
    return [cmd];
  },
};

export default completionModule;
