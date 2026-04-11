# Source Tree

`src/` has two layers:

- `src/core/` is the kernel: loop, workflow runtime, daemon runtime, event bus, tool runtime, and module protocol/lifecycle.
- `src/modules/` is for pluggable project modules.
- A small number of root `src/*.ts` files may remain as public entrypoints or thin repo-wide glue (`cli.ts`, `init.ts`, `module-api.ts`, `validate-queue.ts`). Everything else should prefer `src/core/` or `src/modules/`.

Guidelines:

- Keep `src/core/` small and protocol-oriented.
- Put swappable features in `src/modules/<name>/`.
- Avoid new root-level buckets under `src/`.
- Use local `AGENTS.md` files before changing a subtree.

Kernel areas:

- `src/core/agents/`
- `src/core/channels/`
- `src/core/config/`
- `src/core/daemon/`
- `src/core/events/`
- `src/core/loop/`
- `src/core/model/`
- `src/core/modules/`
- `src/core/tools/`
- `src/core/workflow/`
- `src/core/agent-sdk/`
- `src/core/data/`
- `src/core/file-tracking/`

Project modules:

- `src/modules/<name>/` owns the code, skills, agents, workflows, routes, and commands for that unit.
- Operator surfaces should use `*-ops` names when they expose CLI/control surfaces for a kernel concept.

Do not add aliases, parallel surfaces, or compatibility wrappers between core and modules.
