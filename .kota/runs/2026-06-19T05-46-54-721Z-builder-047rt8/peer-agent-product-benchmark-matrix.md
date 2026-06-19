# Peer Agent Product Benchmark Matrix

Reviewed: 2026-06-19
Task: `task-add-peer-agent-product-benchmark-matrix`

## Review Boundary

This benchmark compares peer product capabilities against existing KOTA
concepts. It does not create new subsystems for peer vocabulary. Durable
changes from this cycle are limited to:

- Watchlist entries for recurring, revisit-worthy peer product surfaces:
  Agent Zero, Space Agent, Rowboat, Open Notebook, and OpenAI Secure MCP
  Tunnel.
- One follow-up task:
  `task-add-private-mcp-tunnel-connector-support`.

No external-pattern decision entry changed because the review did not overturn
an existing durable verdict.

## Matrix

| Peer / pattern | Source URLs | Capability | KOTA equivalent | Gap | Decision | Bounded next action |
| --- | --- | --- | --- | --- | --- | --- |
| DOX | https://github.com/agent0ai/space-agent/blob/main/AGENTS.md | Binding AGENTS.md hierarchy with closeout pass, child ownership index, and explicit doc update rules. | Scoped `AGENTS.md` hierarchy, repo docs rules, task validation. | KOTA already follows the hierarchy pattern; the child-index convention is useful but not required because KOTA has directory-local docs plus validation. | Adapt / already covered. | Added Space Agent to watchlist as the recurring DOX signal; no KOTA doc subsystem or child-index task. |
| Agent Zero | https://github.com/agent0ai/agent-zero | Full Linux workbench with desktop, browser annotation, plugins, skills, projects, subagents, host connector, and time-travel snapshots. | `daemon`, `client`, `module`, `tool`, `skill`, `workflow`, `scope`, run artifacts, git history. | KOTA has the primitives but less polished operator workspace affordance around live desktop/browser artifacts and workspace recovery. | Read / watch. | Added watchlist entry; defer tasks until a concrete KOTA client/operator journey needs the same affordance. |
| Space Agent | https://github.com/agent0ai/space-agent | Browser-first workspace that the agent can reshape from inside the running app; hierarchical personal/group space model; admin/time-travel recovery. | Shared UI contribution protocol, web/mobile/apple clients, `scope`, `module`, run artifacts. | Agent-mutated UI is high risk for KOTA's typed surface contract; recovery and browser-first client lessons are useful. | Read / watch. | Added watchlist entry; keep KOTA client surfaces typed and module-contributed unless repeated product evidence shows a need for runtime-authored UI. |
| ClawPatrol | No primary source found for exact `ClawPatrol` name through public web/GitHub search on 2026-06-19. Nearby OpenClaw security sources such as ClawGuard/ClawKeeper were not substituted. | Unknown. | If this is an agent-security project, the likely KOTA primitives would be `guardrails`, `injection-defense`, approval queue, and tool-effect policy. | Source identity is unresolved; adopting from similar names would violate source-access honesty. | Later / no action. | No watchlist entry or task until the owner supplies the exact source or public search reveals a primary source. |
| Rowboat | https://github.com/rowboatlabs/rowboat ; https://docs.rowboatlabs.com/docs/getting-started/introduction | Local-first AI coworker that builds an editable Markdown knowledge graph from email, meetings, notes, and background agents. | `knowledge`, `memory`, `history`, `working-memory`, `scheduler`, `workflow`, clients, channels. | KOTA has store primitives and recent consolidation artifacts; Rowboat raises the bar for an operator-editable graph/client experience but does not require a new memory model. | Adapt / watch. | Added watchlist entry; no new task this cycle because existing stores and consolidation tasks cover the underlying primitive gap. |
| Open Notebook | https://github.com/lfnovo/open-notebook ; https://www.open-notebook.ai/ | Self-hosted NotebookLM-style research surface with source ingestion, vector/full-text search, citations, content transformations, API access, and generated media. | `read-document`, `knowledge`, `knowledge-semantic`, `rendering`, run artifacts, modules. | KOTA needs source-backed research artifacts, not a notebook product; source/citation behavior maps to existing modules. | Reject subsystem / watch source-backed artifact ideas. | Added watchlist entry; no notebook subsystem task. |
| Headroom | https://headroom.com/ | Fetchable evidence was limited to a JS-heavy landing page title: "The Small Business Operating System For AI." | Potentially `client`, `workflow`, `module`, and `scope`, but the capability is unread. | Public fetch did not provide enough primary content to compare honestly. | Later / no action. | No watchlist entry or task until a readable primary source is available. |
| OpenAI secure MCP tunnels | https://developers.openai.com/api/docs/guides/secure-mcp-tunnels ; https://github.com/openai/tunnel-client | Outbound `tunnel-client` lets OpenAI products reach a private MCP server without inbound public access, with workspace/org association, runtime API key, optional mTLS, health/readiness diagnostics, and bounded HTTP callout support. | `mcp-server`, `mcp-registry`, core MCP manager, setup requirements, secrets, daemon/client diagnostics. | KOTA lacks a KOTA-shaped private MCP tunnel profile for cloud agent surfaces; operators would have to expose a public MCP endpoint or hand-roll provider-specific setup. | Adopt bounded pattern. | Opened `task-add-private-mcp-tunnel-connector-support`; no more MCP tunnel tasks this cycle. |
| Project-shaped workflow framing | https://github.com/agent0ai/agent-zero ; https://github.com/agent0ai/space-agent | Peer products frame work as projects/spaces with isolated instructions, memory, secrets, knowledge, repositories, model presets, groups, and recovery. | `scope`, directory-backed project compatibility, task queue, run artifacts, setup requirements, module config. | KOTA already treats project as compatibility language over `scope`; remaining gaps are client render coverage, not a new project primitive. | Adapt / already covered. | No task. Future client work should render scope/project state through shared UI surfaces rather than inventing a project workspace engine. |
| Agent-computer patterns | https://arxiv.org/abs/2405.15793 ; https://arxiv.org/abs/2410.08164 | Agent-computer interfaces make software environments legible and controllable for agents through tailored CLI/GUI affordances, planning, and experience retrieval. | Tool design, harness adapters, browser/computer modules, eval-harness fixtures, run artifacts. | KOTA should improve explicit tool and artifact affordances where evidence shows failures; it does not need a general desktop-control runtime by default. | Read / adapt evidence-first. | No new task. Existing browser, rendering, harness-parity, and eval-harness paths remain the right places to absorb concrete failures. |

## Cycle Outcome

- New tasks opened: 1 of the allowed 3.
- Watchlist entries added: 5, only for ongoing product surfaces with recurring signal.
- Inaccessible or weakly readable sources: ClawPatrol, Headroom.
- Durable external-pattern decisions changed: 0.
