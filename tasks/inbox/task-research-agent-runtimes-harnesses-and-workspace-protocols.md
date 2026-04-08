# Research: Agent Runtimes, Harnesses, And Workspace Protocols

Explorer should compare other agent runtimes, harnesses, and workspace conventions to sharpen KOTA's daemon, extension, and workspace protocol design without assuming KOTA should mimic them closely.

Focus:
- minimal core with strong extension boundaries
- workspace files as protocol, not ad-hoc clutter
- multi-agent handoff, review, and interoperability patterns

Things to look at:
- What runtime boundaries are consistently handled outside core in these systems?
- What should KOTA borrow for workspace layout, instruction loading, and interop?
- Which ideas seem reusable as adapters or plugins rather than rewrites?

Resources:
- https://github.com/MaxGfeller/open-harness — code-first composable SDK for powerful AI agents.
- https://github.com/RightNow-AI/openfang — open-source agent operating system.
- https://github.com/aaif-goose/goose — extensible open-source AI agent focused on install/execute/edit/test workflows.
- https://github.com/NousResearch/hermes-agent — large agent runtime with strong ecosystem gravity.
- https://autobe.dev/blog/function-calling-harness-qwen-meetup-korea/ — function-calling harness article focused on improving tool-call reliability.
- https://x.com/reach_vb/status/2038670509768839458 — Codex plugin for Claude Code; useful for cross-agent handoff and second-pass review patterns.
- https://x.com/coreyganim/status/2036070952987988290 — OpenClaw workspace anatomy; useful for workspace-file and protocol design.
- https://clawhub.ai/plugins/%40axonflow%2Fopenclaw — OpenClaw-related plugin listing; relevant to plugin/runtime packaging.
- https://github.com/pbakaus/impeccable — design language for improving AI harness design quality.

What Explorer should produce later:
- a clearer sense of what KOTA should borrow, adapt around, or just watch from these runtimes
