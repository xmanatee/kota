# KOTA

KOTA uses repo-local docs, project data files, and directory-level `AGENTS.md` files to
explain structure, standards, current priorities, and how work moves through
the repo.

- Before broad work, read parent `AGENTS.md` files up to the mono root; nearest scoped instructions apply last.
- Before broad KOTA changes, read `docs/STANDARDS.md` and `docs/ARCHITECTURE.md`.
- Before touching data files or task state, read `data/AGENTS.md` and `data/tasks/AGENTS.md`.
- When touching a directory, read its local `AGENTS.md` first if present.
- Keep docs, data files, and local `AGENTS.md` files aligned with reality.
- In a sandboxed linked worktree whose host Git metadata is read-only, a
  workspace-local `GIT_INDEX_FILE` also needs a local `GIT_OBJECT_DIRECTORY`
  plus the host object store in `GIT_ALTERNATE_OBJECT_DIRECTORIES`. Use that
  only to validate the exact commit set; record the host-index replay because
  isolated staging does not update the real worktree index.
